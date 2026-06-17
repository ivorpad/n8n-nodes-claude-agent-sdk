import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['nodes/**/__tests__/**/*.test.ts'],
		exclude: ['node_modules', 'dist'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: [
				'nodes/**/permissions/**/*.ts',
				'nodes/**/streaming/**/*.ts',
				'nodes/**/operations/**/*.ts',
				'nodes/**/notifications/**/*.ts',
				'nodes/**/sdk/**/*.ts',
				'nodes/**/webhook/**/*.ts',
			],
			exclude: [
				'**/*.d.ts',
				'**/types.ts',
				'**/index.ts',
				'**/properties.ts',
			],
		},
	},
});
