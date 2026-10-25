import {
	defineConfig
} from 'vite';
export default defineConfig({
	// v1.8.0 #20: build-time baked default server URL for bundled shells
	// (desktop/Android). Set via the JMLT_DEFAULT_SERVER env at build time
	// (CI reads the JMLT_DEFAULT_SERVER_URL repository variable). Sanitized
	// client-side (https only); empty string = same-origin fallback unchanged.
	// v1.8.1: shipped nodecrypt.btc31415926eth.workers.dev as the built-in
	// default. v1.8.2: switched to https://chat.68626.us.ci — workers.dev is
	// SNI-blocked in some regions; the custom domain resolves directly.
	// v1.8.0 #20：构建期烤入的默认服务器地址（供桌面/安卓壳零配置开箱）。
	// 构建时通过 JMLT_DEFAULT_SERVER 环境变量注入。客户端侧再消毒（仅 https）。
	// v1.8.1 内置 workers.dev 默认值；v1.8.2 换为 chat.68626.us.ci
	// ——部分地区对 workers.dev 做 SNI 封锁，自定义域可直连。
	define: {
		__JMLT_DEFAULT_SERVER__: JSON.stringify(process.env.JMLT_DEFAULT_SERVER || 'https://chat.68626.us.ci'),
	},
	// Root directory
	// 根目录
	root: 'client',
	// Base URL
	// 基础 URL
	base: './',
	// Plugins
	// 插件
	plugins: [],
	// Build options
	// 构建选项
	build: {
		// Output directory
		// 输出目录
		outDir: '../dist',
		// Empty output directory
		// 清空输出目录
		emptyOutDir: true,
		// Minify
		// 压缩
		minify: 'terser',
		// Terser options
		// Terser 选项
		terserOptions: {
			compress: {
				// Drop console statements
				// 删除 console 语句
				drop_console: false,
				// Drop debugger statements
				// 删除 debugger 语句
				drop_debugger: false
			}
		},
		// Rollup options
		// Rollup 选项
		rollupOptions: {			// Input file
			// 输入文件
			input: 'client/index.html',
			// Output options
			// 输出选项
			output: {
				// Manual chunks
				// 手动分块
				manualChunks: (id) => {
					if (id.includes('node_modules')) {
						if (/aes-js|elliptic|js-chacha20|js-sha256/.test(id)) {
							return 'crypto-libs'
						}
						return 'vendor-deps'
					}
					return undefined
				},
			},
		},
		// Sourcemap
		// Sourcemap
		sourcemap: false,
		// CSS code split
		// CSS 代码分割
		cssCodeSplit: true,
		// Chunk size warning limit
		// 代码块大小警告限制
		chunkSizeWarningLimit: 1000,
	},
	// Resolve options
	// 解析选项
	resolve: {
		// Alias
		// 别名
		alias: {
			buffer: 'buffer',
		},
	},
	// Server options
	// 服务器选项
	server: {
		// HMR
		// 热模块替换
		hmr: true,
		// Open browser
		// 打开浏览器
		open: true,
	},
	// Optimize dependencies
	// 优化依赖
	optimizeDeps: {
		// Include
		// 包含
		include: ['buffer', 'aes-js', 'elliptic', 'js-chacha20', 'js-sha256', '@dicebear/core', '@dicebear/micah'],
	},
});