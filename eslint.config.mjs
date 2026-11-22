// ESLint flat config — correctness rules ONLY (review item 25).
// 仅正确性集：不做风格格式化（Prettier 已明确不做，见评审「不值得做」）。
// Rules: no-undef / no-unused-vars / no-unreachable / no-constant-condition
// + no-empty (aimed at silent catch blocks). Everything else stays off so
// this gate catches real bugs without producing style churn.
//
// caughtErrors: 'none' — this codebase's documented convention is the
// best-effort catch (storage unavailable, stale call candidates, dropped
// receipts…); nearly every catch carries an explanatory comment and
// intentionally discards the error value. Truly EMPTY blocks are still
// caught by no-empty (a block containing only a comment is not empty).
import globals from 'globals';

const correctness = {
	'no-undef': 'error',
	'no-unused-vars': ['error', {
		argsIgnorePattern: '^_',
		varsIgnorePattern: '^_',
		caughtErrors: 'none',
	}],
	'no-unreachable': 'error',
	'no-constant-condition': 'error',
	'no-empty': 'error',
};

export default [
	{
		ignores: ['dist/**', 'node_modules/**', 'server/node_modules/**', 'desktop/**'],
	},
	{
		// Browser client code
		files: ['client/js/**/*.js', 'client/public/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.browser,
				// Vite build-time define (vite.config.js `define`), not a
				// runtime global — declared so no-undef stays meaningful.
				__JMLT_DEFAULT_SERVER__: 'readonly',
			},
		},
		rules: correctness,
	},
	{
		// Cloudflare Worker code (wrangler.toml enables nodejs_compat:
		// worker/utils.js imports node:crypto and uses the Buffer global;
		// WebSocketPair is a Workers runtime global)
		files: ['worker/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.serviceworker,
				WebSocketPair: 'readonly',
				Buffer: 'readonly',
			},
		},
		rules: correctness,
	},
	{
		// Node server / tests / scripts / build config
		files: ['server/**/*.js', 'test-*.mjs', 'scripts/**/*.mjs', 'vite.config.js', 'eslint.config.mjs'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.node,
				// test-localHistory.mjs installs a localStorage shim on
				// globalThis and exercises the browser-style identifier.
				localStorage: 'readonly',
			},
		},
		rules: correctness,
	},
];
