// 生成 PWA 图标（零依赖，纯 Node 内置 zlib）
// 按 client/assets/favicon.svg 的几何绘制：蓝底 + 白色圆角锁体 + 白锁扣 + 蓝锁孔。
// 全出血蓝底 → 可同时作为 any / maskable 图标使用。
// 用法: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'client', 'public', 'icons');

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0; // filter: none
		rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;  // bit depth
	ihdr[9] = 6;  // color type RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

// ---------- 几何绘制（64x64 逻辑坐标，等比放大） ----------
const BLUE = [0x35, 0x7a, 0xe8];
const WHITE = [0xff, 0xff, 0xff];

// 圆角矩形 SDF：中心 (32,40)，半宽 20，半高 16，圆角 10（锁体 x:12-52 y:20-52）
function inLockBody(px, py) {
	const hx = Math.max(Math.abs(px - 32) - 10, 0);
	const hy = Math.max(Math.abs(py - 40) - 6, 0);
	return Math.sqrt(hx * hx + hy * hy) - 10 <= 0;
}
// 锁扣：圆心 (32,20)，环 9..15（描边 6），只取上半段 y<=28
function inShackle(px, py) {
	if (py > 28) return false;
	const d = Math.sqrt((px - 32) ** 2 + (py - 20) ** 2);
	return d >= 9 && d <= 15;
}
// 锁孔：圆心 (32,40) r=5
function inKeyhole(px, py) {
	return (px - 32) ** 2 + (py - 40) ** 2 <= 25;
}

function renderIcon(size) {
	const SS = 4; // 每像素 4x4 超采样抗锯齿
	const rgba = Buffer.alloc(size * size * 4);
	const step = 64 / size / SS;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let white = 0, keyhole = 0;
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const px = (x * SS + sx + 0.5) * step;
					const py = (y * SS + sy + 0.5) * step;
					if (inKeyhole(px, py)) { keyhole++; continue; }
					if (inShackle(px, py) || inLockBody(px, py)) white++;
				}
			}
			const w = white / (SS * SS), k = keyhole / (SS * SS);
			// 背景 = BLUE；白色部件按覆盖率混入；锁孔按覆盖率混回 BLUE
			const r = Math.round((BLUE[0] * (1 - w) + WHITE[0] * w) * (1 - k) + BLUE[0] * k);
			const g = Math.round((BLUE[1] * (1 - w) + WHITE[1] * w) * (1 - k) + BLUE[1] * k);
			const b = Math.round((BLUE[2] * (1 - w) + WHITE[2] * w) * (1 - k) + BLUE[2] * k);
			const i = (y * size + x) * 4;
			rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
		}
	}
	return encodePNG(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [180, 192, 512]) {
	const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
	const png = renderIcon(size);
	writeFileSync(join(OUT_DIR, name), png);
	console.log(`${name}: ${png.length} bytes`);
}

// P1-D: `--desktop` mode also emits Tauri icon sizes. The 1024 source is NOT
// committed (repo weight); CI runs `node scripts/gen-icons.mjs --desktop`
// then `tauri icon` to derive .icns/.ico from it.
// P1-D：--desktop 模式额外产出 Tauri 图标。1024 源图不入库，由 CI 现场生成
// 再用 `tauri icon` 派生 .icns/.ico。
if (process.argv.includes('--desktop')) {
	const DESKTOP_ICONS = join(ROOT, 'desktop', 'src-tauri', 'icons');
	mkdirSync(DESKTOP_ICONS, { recursive: true });
	for (const size of [32, 128, 256, 1024]) {
		const name = size === 1024 ? 'icon-source.png' : `${size}x${size}.png`;
		const png = renderIcon(size);
		writeFileSync(join(DESKTOP_ICONS, name), png);
		console.log(`desktop/${name}: ${png.length} bytes`);
	}
}
console.log('done');
