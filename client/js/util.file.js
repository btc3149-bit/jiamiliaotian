// Import necessary modules
// 导入必要的模块
import { deflate, inflate, Deflate } from 'fflate';
import { showFileUploadModal } from './util.fileUpload.js';
import { imageFileToCleanFile } from './util.image.js';
import { t } from './util.i18n.js';
// v1.2.0 #17: resume-request validation
import { sanitizeResumeRequest } from './util.validate.js';
// v1.7.0 #19: incremental SHA-256 (streaming hash of large files without
// holding the whole file in memory).
// v1.7.0 #19：增量 SHA-256（大文件流式哈希，无需整文件驻留内存）。
import { sha256 } from 'js-sha256';

// v1.2.0 #17: sender keeps volume data in memory for a retention window so a
// receiver can request re-sends of lost volumes. Cap: 16MB of base64 payload —
// bigger transfers opt out of resume (honest limit, memory only, never
// persisted).
// v1.2.0 #17：发送端在保留窗口内把分卷留在内存，接收端可请求补发丢失分卷。
// 上限 16MB base64 载荷——超限传输放弃续传（诚实上限，仅内存，不落盘）。
const RESUME_RETENTION_MS = 5 * 60 * 1000;
const RESUME_PAYLOAD_CAP = 16 * 1024 * 1024;

// v1.7.0 #19: honest transfer size cap. Everything is memory-only (zero
// server storage, RULES.md invariant 4), so the transfer pipeline must stay
// inside sane RAM bounds: volumes live in memory on BOTH ends until
// consumed. 256 MB per transfer (single file or archive total) keeps peak
// memory around ~350 MB worst case — well under typical mobile/desktop
// budgets. Oversized transfers are refused with a clear message instead of
// crashing the tab.
// v1.7.0 #19：诚实的传输体积上限。全部仅存内存（服务器零存储，RULES 不变量
// 4），传输管线必须留在合理的内存边界内：分卷在两端消费前都驻留内存。
// 单次传输（单文件或归档总量）256MB——最坏峰值内存约 350MB，远低于常规
// 手机/桌面预算。超限传输直接拒绝并给出明确提示，而不是把标签页搞崩。
export const MAX_TRANSFER_BYTES = 256 * 1024 * 1024;

// v1.7.0 #19: pure size validation for a pending transfer. Returns null when
// acceptable, otherwise a machine-readable reason string.
// v1.7.0 #19：待传输体积校验纯函数。可接受返回 null，否则返回可读原因。
export function validateTransferSizes(sizes) {
	if (!Array.isArray(sizes) || sizes.length === 0) return 'empty';
	let total = 0;
	for (const s of sizes) {
		if (typeof s !== 'number' || !Number.isFinite(s) || s < 0) return 'invalid';
		total += s;
		if (total > MAX_TRANSFER_BYTES) return 'too-large';
	}
	return null;
}

// v1.7.0 #19: read one slice of a File/Blob as Uint8Array (memory-friendly:
// never holds more than one slice at a time). Uses Blob.slice().arrayBuffer()
// (works in browsers and Node's File impl — no FileReader, no extra copy).
// v1.7.0 #19：按切片读取 File/Blob 为 Uint8Array（内存友好：任一时刻至多
// 持有一个切片）。用 Blob.slice().arrayBuffer()（浏览器与 Node 的 File 实现
// 都支持——不经过 FileReader，无额外拷贝）。
function readSliceAsUint8(file, offset, length) {
	return file.slice(offset, offset + length).arrayBuffer().then(ab => new Uint8Array(ab));
}

// v1.7.0 #19: shared streaming deflater. Feed raw slices via push(); output
// is split into volumeSize volumes (base64) exactly like the previous
// whole-buffer implementation — ONE continuous deflate stream, so the wire
// format is byte-compatible with older clients (receiver unchanged).
// v1.7.0 #19：共享的流式 deflate 器。通过 push() 喂原始切片；输出按
// volumeSize 切成分卷（base64），与旧的整缓冲实现完全一致——单条连续
// deflate 流，线格式与老客户端字节兼容（接收端零改动）。
class VolumeDeflater {
	constructor(volumeSize = DEFAULT_VOLUME_SIZE) {
		this.volumeSize = volumeSize;
		this.volumes = [];
		this.compressedSize = 0;
		this._cur = new Uint8Array(volumeSize);
		this._curLen = 0;
		this._deflater = new Deflate({ level: 6, mem: 8 }, (dat) => this._sink(dat));
	}
	_sink(bytes) {
		this.compressedSize += bytes.length;
		let off = 0;
		while (off < bytes.length) {
			const take = Math.min(this.volumeSize - this._curLen, bytes.length - off);
			this._cur.set(bytes.subarray(off, off + take), this._curLen);
			this._curLen += take;
			off += take;
			if (this._curLen === this.volumeSize) {
				this.volumes.push(arrayBufferToBase64(this._cur));
				this._cur = new Uint8Array(this.volumeSize);
				this._curLen = 0;
			}
		}
	}
	push(bytes, final = false) {
		this._deflater.push(bytes, final);
	}
	finish() {
		if (this._curLen > 0) {
			this.volumes.push(arrayBufferToBase64(this._cur.subarray(0, this._curLen)));
			this._cur = null;
			this._curLen = 0;
		}
		if (this.volumes.length === 0) {
			// Deflate of any input (even empty) always emits stream bytes; the
			// guard keeps the invariant "at least one volume" for receivers.
			// 任何输入（包括空）的 deflate 都会产出流字节；此守卫维持「至少
			// 一个分卷」的接收端不变量。
			this.volumes.push('')
		}
		return this.volumes;
	}
}

// Named exports for Node-based tests (browser unaffected).
// 具名导出供 Node 测试使用（浏览器不受影响）。
export { VolumeDeflater, compressFileToVolumes, compressFilesToArchive };

// v1.1.0 #10: "send original image" opt-out from settings (default off = auto
// compress + EXIF strip). Read directly to avoid a circular import with
// util.settings.js.
// v1.1.0 #10：「发送原图」设置项（默认关 = 自动压缩 + 剥 EXIF）。直接读
// localStorage 避免与 util.settings.js 循环导入。
function isAutoImageCompressEnabled() {
	try {
		const s = JSON.parse(localStorage.getItem('settings') || '{}');
		return !s.sendOriginal
	} catch (_e) {
		return true
	}
}

// 分卷大小统一配置
const DEFAULT_VOLUME_SIZE = 256 * 1024; // 512KB

// File transfer state management
// 文件传输状态管理
window.fileTransfers = new Map();

// Base64 encoding for binary data (more efficient than hex)
// Base64编码用于二进制数据（比十六进制更高效）
function arrayBufferToBase64(buffer) {
	const uint8Array = new Uint8Array(buffer);
	let binary = '';
	const chunkSize = 0x8000; // 32KB chunks to avoid call stack limits
	
	for (let i = 0; i < uint8Array.length; i += chunkSize) {
		const chunk = uint8Array.subarray(i, i + chunkSize);
		binary += String.fromCharCode.apply(null, chunk);
	}
	
	return btoa(binary);
}

// Base64 decoding back to binary
// Base64解码回二进制数据
function base64ToArrayBuffer(base64) {
	const binary = atob(base64);
	const uint8Array = new Uint8Array(binary.length);
	
	for (let i = 0; i < binary.length; i++) {
		uint8Array[i] = binary.charCodeAt(i);
	}
	
	return uint8Array;
}

// Generate unique file ID
// 生成唯一文件ID
function generateFileId() {
	return 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Calculate SHA-256 hash for data integrity verification
// 计算SHA-256哈希值用于数据完整性验证
async function calculateHash(data) {
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}



// Compress file into volumes (v1.7.0 #19: STREAMING). The file is read in
// slices; each slice is hashed incrementally and fed to one continuous
// deflate stream whose output is split into volumes on the fly. Peak memory
// is now ~1.3x the COMPRESSED size (the volume list) instead of ~3.3x the
// raw size (raw + compressed + base64 volumes). Wire format unchanged.
// 将文件压缩为分卷（v1.7.0 #19：流式）。文件按切片读取；每片增量哈希并喂入
// 单条连续 deflate 流，输出即时切成分卷。峰值内存从原规模的 ~3.3 倍原始
// 体积（原始+压缩+base64 分卷）降到 ~1.3 倍压缩体积（分卷列表本身）。
// 线格式不变。
async function compressFileToVolumes(file, volumeSize = DEFAULT_VOLUME_SIZE) {
	const hash = sha256.create();
	const deflater = new VolumeDeflater(volumeSize);
	const SLICE = 1024 * 1024;
	for (let off = 0; off < file.size; off += SLICE) {
		const slice = await readSliceAsUint8(file, off, Math.min(SLICE, file.size - off));
		hash.update(slice);
		deflater.push(slice, false);
	}
	deflater.push(new Uint8Array(0), true);
	const volumes = deflater.finish();
	return {
		volumes,
		originalSize: file.size,
		compressedSize: deflater.compressedSize,
		originalHash: hash.hex()
	};
}

// Compress multiple files into a single archive with volumes
// (v1.7.0 #19: STREAMING — parts are fed to one continuous deflate stream
// slice-by-slice instead of concatenating everything in RAM first. The
// archive byte layout is IDENTICAL to the old implementation, so receivers
// need no change.)
// 将多个文件压缩为单个分卷归档（v1.7.0 #19：流式——各部件逐片喂入单条连续
// deflate 流，不再先在内存里拼接全部数据。归档字节布局与旧实现完全一致，
// 接收端零改动。）
async function compressFilesToArchive(files, volumeSize = DEFAULT_VOLUME_SIZE) {
	try {
		// Simple archive format: [file1_size][file1_name_length][file1_name][file1_data][file2_size]...
		// 简单归档格式：[name_length(4)][name][size(8)][data]
		const fileManifest = [];
		const hash = sha256.create();
		const deflater = new VolumeDeflater(volumeSize);
		let rawTotal = 0;

		const emit = async (part) => {
			rawTotal += part.length;
			hash.update(part);
			deflater.push(part, false);
		};

		for (const file of files) {
			const nameBytes = new TextEncoder().encode(file.name);

			fileManifest.push({
				name: file.name,
				size: file.size,
				offset: 0 // unchanged legacy field (never used) / 沿用旧字段（从未使用）
			});

			const nameLengthBytes = new Uint8Array(4);
			new DataView(nameLengthBytes.buffer).setUint32(0, nameBytes.length, true); // little endian

			const fileSizeBytes = new Uint8Array(8);
			new DataView(fileSizeBytes.buffer).setBigUint64(0, BigInt(file.size), true); // little endian

			await emit(nameLengthBytes);
			await emit(nameBytes);
			await emit(fileSizeBytes);

			const SLICE = 1024 * 1024;
			for (let off = 0; off < file.size; off += SLICE) {
				await emit(await readSliceAsUint8(file, off, Math.min(SLICE, file.size - off)));
			}
		}

		deflater.push(new Uint8Array(0), true);
		const volumes = deflater.finish();
		return {
			volumes,
			originalSize: rawTotal,
			compressedSize: deflater.compressedSize,
			archiveHash: hash.hex(),
			fileCount: files.length,
			fileManifest
		};
	} catch (error) {
		throw new Error(`Archive compression failed: ${error.message}`);
	}
}

// Helper function to read file as array buffer
// 辅助函数：将文件读取为ArrayBuffer
function readFileAsArrayBuffer(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = (e) => resolve(e.target.result);
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(file);
	});
}

// Decompress volumes back to file
// 将分卷解压回文件
async function decompressVolumesToFile(volumes, fileName, originalHash = null) {
	try {
		// Combine all volumes using base64 decoding
		const combinedData = volumes.map(volume => {
			return base64ToArrayBuffer(volume);
		});
		
		const totalLength = combinedData.reduce((sum, arr) => sum + arr.length, 0);
		const compressed = new Uint8Array(totalLength);
		let offset = 0;
		
		for (const data of combinedData) {
			compressed.set(data, offset);
			offset += data.length;
		}
				// Decompress
		return new Promise((resolve, reject) => {
			inflate(compressed, async (err, decompressed) => {
				if (err) {
					reject(err);
					return;
				}
				
				// Verify hash if provided
				if (originalHash) {
					try {
						const calculatedHash = await calculateHash(decompressed);
						if (calculatedHash !== originalHash) {
							reject(new Error('File integrity check failed: hash mismatch'));
							return;
						}
					} catch (hashError) {
						reject(new Error('File integrity check failed: ' + hashError.message));
						return;
					}
				}
				
				// Create blob and download
				const blob = new Blob([decompressed]);
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = fileName;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
				
				resolve();
			});
		});
	} catch (error) {
		console.error('Decompression error:', error);
		throw error;
	}
}

// Decompress archive volumes to multiple files
// 将归档分卷解压为多个文件
async function decompressArchiveToFiles(volumes, fileManifest, archiveHash = null) {
	try {
		// Combine all volumes using base64 decoding
		const combinedData = volumes.map(volume => {
			return base64ToArrayBuffer(volume);
		});
		
		const totalLength = combinedData.reduce((sum, arr) => sum + arr.length, 0);
		const compressed = new Uint8Array(totalLength);
		let offset = 0;
		
		for (const data of combinedData) {
			compressed.set(data, offset);
			offset += data.length;
		}
		
		// Decompress archive
		return new Promise((resolve, reject) => {
			inflate(compressed, async (err, decompressed) => {
				if (err) {
					reject(err);
					return;
				}
				
				// Verify archive hash if provided
				if (archiveHash) {
					try {
						const calculatedHash = await calculateHash(decompressed);
						if (calculatedHash !== archiveHash) {
							reject(new Error('Archive integrity check failed: hash mismatch'));
							return;
						}
					} catch (hashError) {
						reject(new Error('Archive integrity check failed: ' + hashError.message));
						return;
					}
				}
						// Extract files from archive
				let dataOffset = 0;
				const extractedFiles = [];
						for (const fileInfo of fileManifest) {
					// Read file metadata: [name_length(4)][name][size(8)][data]
					const nameLengthBytes = decompressed.slice(dataOffset, dataOffset + 4);
					const nameLengthView = new DataView(nameLengthBytes.buffer);
					const nameLength = nameLengthView.getUint32(0, true); // little endian
					dataOffset += 4;
					
					const nameBytes = decompressed.slice(dataOffset, dataOffset + nameLength);
					const fileName = new TextDecoder().decode(nameBytes);
					dataOffset += nameLength;
					
					// Use DataView to read BigUint64 safely
					const fileSizeBytes = decompressed.slice(dataOffset, dataOffset + 8);
					const fileSizeView = new DataView(fileSizeBytes.buffer);
					const fileSize = Number(fileSizeView.getBigUint64(0, true)); // little endian
					dataOffset += 8;
					
					const fileData = decompressed.slice(dataOffset, dataOffset + fileSize);
					dataOffset += fileSize;
					
					// Create and download file
					const blob = new Blob([fileData]);
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = fileName;
					document.body.appendChild(a);
					a.click();
					document.body.removeChild(a);
					URL.revokeObjectURL(url);
					
					extractedFiles.push(fileName);
					
					// Add small delay between downloads to avoid overwhelming the browser
					await new Promise(resolve => setTimeout(resolve, 100));
				}
				
				resolve(extractedFiles);
			});
		});
	} catch (error) {
		console.error('Archive decompression error:', error);
		throw error;
	}
}

// Setup file sending functionality
// 设置文件发送功能
export function setupFileSend({
	inputSelector,
	attachBtnSelector,
	fileInputSelector,
	onSend
}) {
	const attachBtn = document.querySelector(attachBtnSelector);
	
	if (attachBtn) {
		// 点击附件按钮显示文件上传模态框
		// Click attach button to show file upload modal
		attachBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			
			showFileUploadModal(async (files) => {
				// 传递 userName 给 onSend
				const userName = window.roomsData && window.activeRoomIndex >= 0
					? (window.roomsData[window.activeRoomIndex]?.myUserName || '')
					: '';
				await handleFilesUpload(files, (msg) => {
					// 合并 userName 字段
					onSend({ ...msg, userName });
				});
			});
		});
	}
}

// Handle files upload
// 处理文件上传
async function handleFilesUpload(files, onSend) {
	if (!files || files.length === 0) return;

	// v1.7.0 #19: honest sender cap — refuse oversized transfers BEFORE any
	// memory is committed. Zero server storage means the whole transfer lives
	// in RAM on both ends; a hard ceiling beats a crashed tab.
	// v1.7.0 #19：发送端诚实上限——在任何内存分配之前拒绝超限传输。
	// 服务器零存储意味着整次传输在两端都驻留内存；明确的天花板胜过崩掉的标签页。
	const bad = validateTransferSizes(Array.from(files).map(f => f.size));
	if (bad) {
		if (window.addSystemMsg) {
			window.addSystemMsg(t('file.too_large', 'Transfer too large — the limit is {limit} per send (everything stays in memory; the server stores nothing).').replace('{limit}', formatFileSize(MAX_TRANSFER_BYTES)), true)
		}
		return;
	}

	const fileId = generateFileId();
	
	try {
		// Show compression progress
		let progressElement = null;
		
		function showProgress(message) {
			// 删除系统提示
		}
		
		function updateProgress(message) {
			// 删除系统提示
		}
		
		if (files.length === 1) {
			// Single file upload
			let file = files[0];
			showProgress();

			// v1.1.0 #10: default pipeline for still images = canvas redraw
			// (strips EXIF incl. GPS/model, caps 1280px, webp 90%). "Send
			// original" in settings restores the raw-file path. Gifs pass
			// through untouched (animation preserved).
			// v1.1.0 #10：静态图片默认走 canvas 重绘（剥 EXIF 含 GPS/机型、
			// 限 1280px、webp 90%）。设置里开「发送原图」则保留原始文件。
			// gif 不重绘（保动图）。
			if (isAutoImageCompressEnabled()) {
				try {
					const cleaned = await imageFileToCleanFile(file);
					if (cleaned) file = cleaned;
				} catch (_e) { /* keep original file */ }
			}

			const { volumes, originalSize, compressedSize, originalHash } = await compressFileToVolumes(file);
			
			updateProgress();
			
		// Create file transfer state
		const fileTransfer = {
			fileId,
			fileName: file.name,
			originalSize,
			compressedSize,
			totalVolumes: volumes.length,
			sentVolumes: 0,
			status: 'sending',
			originalHash,
			roomIdx: typeof window.activeRoomIndex === 'number' ? window.activeRoomIndex : null,
			isPrivate: false
		};
			
			window.fileTransfers.set(fileId, fileTransfer);
			
			// Send file start message
			onSend({
				type: 'file_start',
				fileId,
				fileName: file.name,
				originalSize,
				compressedSize,
				totalVolumes: volumes.length,
				originalHash
			});
			
			// Send volumes
			await sendVolumes(fileId, volumes, onSend, updateProgress, file.name);
			
		} else {
			// Multiple files upload - create archive
			const totalSize = files.reduce((sum, file) => sum + file.size, 0);
			showProgress();
			
			const { volumes, originalSize, compressedSize, archiveHash, fileCount, fileManifest } = await compressFilesToArchive(files);
			
			updateProgress();
			
			// Create file transfer state for archive
			const fileTransfer = {
				fileId,
				fileName: `${files.length} files.zip`, // Virtual archive name
				originalSize,
				compressedSize,
				totalVolumes: volumes.length,
				sentVolumes: 0,
				status: 'sending',
				archiveHash,
				fileCount,
				fileManifest,
				isArchive: true
			};
			
			window.fileTransfers.set(fileId, fileTransfer);
			
			// Send archive start message
			onSend({
				type: 'file_start',
				fileId,
				fileName: `${files.length} files`,
				originalSize,
				compressedSize,
				totalVolumes: volumes.length,
				archiveHash,
				fileCount,
				fileManifest,
				isArchive: true
			});
			
			// Send volumes
			await sendVolumes(fileId, volumes, onSend, updateProgress, `${files.length} files`);
		}
		
	} catch (error) {
		console.error('File compression error:', error);
		if (window.addSystemMsg) {
			window.addSystemMsg(`Failed to compress files: ${error.message}`);
		}
	}
}

// Send volumes with progress tracking
// 发送分卷并跟踪进度
async function sendVolumes(fileId, volumes, onSend, updateProgress, fileName) {
	const fileTransfer = window.fileTransfers.get(fileId);
	if (!fileTransfer) return;

	// v1.2.0 #17: retain volumes for resume (size-capped, time-limited).
	// v1.2.0 #17：保留分卷以支持续传（限大小、限时长）。
	const payloadChars = volumes.reduce((s, v) => s + (v ? v.length : 0), 0);
	if (payloadChars <= RESUME_PAYLOAD_CAP) {
		fileTransfer.volumesRef = volumes;
		setTimeout(() => { if (fileTransfer.volumesRef === volumes) fileTransfer.volumesRef = null; }, RESUME_RETENTION_MS)
	}
	
	let currentVolume = 0;
	const batchSize = 5; // 每批发送5个分卷
	
	function sendNextBatch() {
		if (currentVolume >= volumes.length) {
			// 发送完成消息
			onSend({
				type: 'file_complete',
				fileId
			});
			
			fileTransfer.status = 'completed';
			updateFileProgress(fileId);
			updateProgress(`✓ Sent ${fileName} successfully`);
			return;
		}
		
		// 发送当前批次
		const batchEnd = Math.min(currentVolume + batchSize, volumes.length);
		const batch = [];
		
		for (let i = currentVolume; i < batchEnd; i++) {
			batch.push({
				type: 'file_volume',
				fileId,
				volumeIndex: i,
				volumeData: volumes[i],
				isLast: i === volumes.length - 1
			});
		}
		
		// 发送批次中的所有分卷
		batch.forEach(volumeMsg => onSend(volumeMsg));
		
		// 更新发送进度
		fileTransfer.sentVolumes = batchEnd;
		updateFileProgress(fileId);
		
		currentVolume = batchEnd;
		
		// 继续发送下一批，使用较短的延迟
		setTimeout(sendNextBatch, 100);
	}
	
	// 开始发送
	sendNextBatch();
}

// Update file progress in chat
// 更新聊天中的文件进度
function updateFileProgress(fileId) {
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer) return;
	const elements = document.querySelectorAll(`[data-file-id="${fileId}"]`);
	elements.forEach(element => {
		const progressContainer = element.querySelector('.file-progress-container');
		const progressBar = element.querySelector('.file-progress');
		const statusText = element.querySelector('.file-status');
		const downloadBtn = element.querySelector('.file-download-btn');
		
		// 判断是否为发送方（发送方没有volumeData）
		const isSender = !transfer.volumeData || transfer.volumeData.length === 0;
		
		if (transfer.status === 'sending') {
			const progress = (transfer.sentVolumes / transfer.totalVolumes) * 100;
			if (progressContainer) {
				progressContainer.style.display = 'block';
				progressContainer.classList.remove('fade-out');
			}
			if (progressBar) progressBar.style.width = `${progress}%`;
			if (statusText) statusText.textContent = `Sending ${transfer.sentVolumes}/${transfer.totalVolumes}`;
			if (downloadBtn) {
				downloadBtn.classList.remove('show', 'animate-in');
				downloadBtn.style.display = 'none';
			}
		} else if (transfer.status === 'receiving' || transfer.status === 'incomplete') {
			const progress = (transfer.receivedVolumes.size / transfer.totalVolumes) * 100;
			if (progressContainer) {
				progressContainer.style.display = 'block';
				progressContainer.classList.remove('fade-out');
			}
			if (progressBar) progressBar.style.width = `${progress}%`;
			if (statusText) statusText.textContent = transfer.status === 'incomplete'
				? t('file.waiting_resume', 'Waiting for re-send…')
				: `Receiving ${transfer.receivedVolumes.size}/${transfer.totalVolumes}`;
			if (downloadBtn) {
				downloadBtn.classList.remove('show', 'animate-in');
				downloadBtn.style.display = 'none';
			}
		} else if (transfer.status === 'completed') {
			// 传输完成时的动画序列
			if (progressContainer) {
				// 先添加淡出动画类
				progressContainer.classList.add('fade-out');
				// 延迟后完全隐藏
				setTimeout(() => {
					progressContainer.style.display = 'none';
				}, 400);
			}
			
			if (downloadBtn) {
				// 只有接收方才显示下载按钮
				if (isSender) {
					downloadBtn.classList.remove('show', 'animate-in');
					downloadBtn.style.display = 'none';
				} else {
					// 延迟显示下载按钮，等进度条消失动画完成
					setTimeout(() => {
						downloadBtn.style.display = 'flex';
						downloadBtn.classList.add('show');
						downloadBtn.disabled = false;
						// 添加进入动画
						setTimeout(() => {
							downloadBtn.classList.add('animate-in');
						}, 50);
						// 清理动画类
						setTimeout(() => {
							downloadBtn.classList.remove('animate-in');
						}, 550);
					}, 200);
				}
			}
		}
	});
}

// Handle incoming file messages
// 处理接收到的文件消息
export function handleFileMessage(message, isPrivate = false, roomIdx = null) {
	const { type, fileId, userName } = message;

	switch (type) {
		case 'file_start':
			handleFileStart(message, isPrivate, roomIdx);
			break;
		case 'file_volume':
			handleFileVolume(message);
			break;
		case 'file_complete':
			handleFileComplete(message);
			break;
		// v1.2.0 #17: peer asks us to re-send lost volumes (public transfers only)
		case 'file_resume_req':
			handleFileResumeReq(message);
			break;
	}
}

// v1.2.0 #17: route a control/volume message for a transfer through the room
// it belongs to. Public transfers only — private routing needs a live target
// clientId which cannot survive a reconnect (honest scope limit).
// v1.2.0 #17：把控制/分卷消息经该传输所属房间发出。仅限公共传输——私聊路由
// 依赖会话级 clientId，重连后必然失效（诚实边界）。
function routeFileMessage(transfer, msg) {
	if (!transfer || transfer.isPrivate) return false;
	const rd = window.roomsData && typeof transfer.roomIdx === 'number' ? window.roomsData[transfer.roomIdx] : null;
	if (!rd || !rd.chat || typeof rd.chat.sendChannelMessage !== 'function') return false;
	try {
		return !!rd.chat.sendChannelMessage(msg.type, msg)
	} catch (_e) {
		return false
	}
}

// v1.2.0 #17: sender side — re-send the missing volumes, then file_complete.
// v1.2.0 #17：发送端——补发丢失分卷，再补一个 file_complete。
function handleFileResumeReq(message) {
	const req = sanitizeResumeRequest(message && message.fileId, message && message.missing, message && message.totalVolumes);
	if (!req) return;
	const transfer = window.fileTransfers.get(req.fileId);
	if (!transfer || transfer.isPrivate || !Array.isArray(transfer.volumesRef)) return;
	if (transfer.status !== 'completed' && transfer.status !== 'sending') return;
	const volumes = transfer.volumesRef;
	const missing = req.missing.filter((i) => i >= 0 && i < volumes.length);
	if (missing.length === 0) return;
	let cursor = 0;
	const batch = 5;
	(function sendNext() {
		const end = Math.min(cursor + batch, missing.length);
		for (let k = cursor; k < end; k++) {
			const i = missing[k];
			routeFileMessage(transfer, {
				type: 'file_volume',
				fileId: transfer.fileId,
				volumeIndex: i,
				volumeData: volumes[i],
				isLast: i === volumes.length - 1
			})
		}
		cursor = end;
		if (cursor < missing.length) {
			setTimeout(sendNext, 100)
		} else {
			routeFileMessage(transfer, { type: 'file_complete', fileId: transfer.fileId })
		}
	})()
}

// Handle file start message
// 处理文件开始消息
function handleFileStart(message, isPrivate, roomIdx) {
	const { fileId, fileName, originalSize, compressedSize, totalVolumes, originalHash, archiveHash, fileCount, fileManifest, isArchive, userName } = message;

	// v1.7.0 #19: receiver-side memory guard. The sender declares both sizes
	// up front; a transfer that would blow the RAM budget is refused before a
	// single volume arrives (an old client can still SENT it — we just
	// decline to buffer it). The chat entry still renders, honestly marked.
	// v1.7.0 #19：接收端内存护栏。发送端在 file_start 就声明两个体积；会
	// 击穿内存预算的传输在第一个分卷到达前即拒绝（老客户端仍可能发——我们
	// 只是拒收）。聊天条目照常渲染，并如实标注。
	if ((typeof compressedSize === 'number' && compressedSize > MAX_TRANSFER_BYTES) ||
		(typeof originalSize === 'number' && originalSize > MAX_TRANSFER_BYTES)) {
		if (window.addSystemMsg) {
			window.addSystemMsg(t('system.file_too_large_incoming', 'Refused "{name}": {size} exceeds this device\'s transfer limit ({limit}).').replace('{name}', fileName || '').replace('{size}', formatFileSize(Math.max(compressedSize || 0, originalSize || 0))).replace('{limit}', formatFileSize(MAX_TRANSFER_BYTES)), true)
		}
		if (window.addOtherMsg) {
			window.addOtherMsg({
				type: 'file',
				fileId,
				fileName: isArchive ? `${fileCount} files` : fileName,
				originalSize,
				totalVolumes,
				userName,
				refused: true
			}, userName, userName, false, isPrivate ? 'file_private' : 'file');
		}
		return;
	}

	const fileTransfer = {
		fileId,
		fileName,
		originalSize,
		compressedSize,
		totalVolumes,
		receivedVolumes: new Set(),
		volumeData: new Array(totalVolumes),
		status: 'receiving',
		originalHash,
		archiveHash,
		fileCount,
		fileManifest,
		isArchive,
		userName, // 记录发送者名字
		roomIdx: typeof roomIdx === 'number' ? roomIdx : (typeof window.activeRoomIndex === 'number' ? window.activeRoomIndex : null),
		isPrivate: !!isPrivate
	};
	
	window.fileTransfers.set(fileId, fileTransfer);
	
	// 添加文件消息到聊天
	if (window.addOtherMsg) {
		let displayData;
		if (isArchive) {
			displayData = {
				type: 'file',
				fileId,
				fileName: `${fileCount} files`,
				originalSize,
				totalVolumes,
				fileCount,
				isArchive: true,
				userName
			};
		} else {
			displayData = {
				type: 'file',
				fileId,
				fileName,
				originalSize,
				totalVolumes,
				userName
			};
		}
		
		window.addOtherMsg(displayData, userName, userName, false, isPrivate ? 'file_private' : 'file');
	}
}

// Handle file volume message
// 处理文件分卷消息
function handleFileVolume(message) {
	const { fileId, volumeIndex, volumeData } = message;
	const transfer = window.fileTransfers.get(fileId);
	
	if (!transfer) return;
	
	transfer.receivedVolumes.add(volumeIndex);
	transfer.volumeData[volumeIndex] = volumeData;
	
	updateFileProgress(fileId);
}

// Handle file complete message
// 处理文件完成消息
function handleFileComplete(message) {
	const { fileId } = message;
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer) return;

	// 检查是否所有分卷都已接收
	if (transfer.receivedVolumes.size === transfer.totalVolumes) {
		transfer.status = 'completed';
		updateFileProgress(fileId);
		return
	}

	// v1.2.0 #17: incomplete on file_complete = some volumes were lost in
	// transit. Public transfers ask the sender to re-send the gaps. Private
	// transfers keep the old behaviour (honest scope limit — the target
	// clientId does not survive a reconnect).
	// v1.2.0 #17：file_complete 时仍有缺口 = 部分分卷在途中丢失。公共传输向
	// 发送端请求补发；私聊保持旧行为（诚实边界——目标 clientId 重连即失效）。
	transfer.status = 'incomplete';
	updateFileProgress(fileId);
	if (transfer.isPrivate) return;
	const missing = [];
	for (let i = 0; i < transfer.totalVolumes; i++) {
		if (!transfer.receivedVolumes.has(i)) missing.push(i)
	}
	const req = sanitizeResumeRequest(fileId, missing, transfer.totalVolumes);
	if (!req) return;
	if (window.addSystemMsg) {
		window.addSystemMsg(t('system.resume_requested', 'Missing {n} part(s) of "{name}" — requesting re-send.').replace('{n}', String(missing.length)).replace('{name}', transfer.fileName || ''), true)
	}
	routeFileMessage(transfer, {
		type: 'file_resume_req',
		fileId: req.fileId,
		missing: req.missing,
		totalVolumes: transfer.totalVolumes
	})
}

// Download file from volumes
// 从分卷下载文件
export async function downloadFile(fileId) {
	const transfer = window.fileTransfers.get(fileId);
	if (!transfer || transfer.status !== 'completed') return;
	
	try {
		if (transfer.isArchive) {
			// Download archive as multiple files
			await decompressArchiveToFiles(transfer.volumeData, transfer.fileManifest, transfer.archiveHash);
			// 删除系统提示
		} else {
			// Download single file
			await decompressVolumesToFile(transfer.volumeData, transfer.fileName, transfer.originalHash);
			// 删除系统提示
		}
	} catch (error) {
		console.error('Download error:', error);
		window.addSystemMsg(`Failed to download: ${error.message}`);
	}
}

// Format file size
// 格式化文件大小
export function formatFileSize(bytes) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Legacy image send function for backward compatibility
// 向后兼容的图片发送函数
export function setupImageSend(config) {
	setupFileSend(config);
}