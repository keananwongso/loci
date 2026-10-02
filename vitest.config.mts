import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
	resolve: {
		alias: {
			'@': path.resolve(import.meta.dirname, 'src'),
			// `server-only` throws outside a React Server Components bundler; tests run in plain Node.
			'server-only': path.resolve(import.meta.dirname, 'src/test/empty.ts'),
		},
	},
	test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
