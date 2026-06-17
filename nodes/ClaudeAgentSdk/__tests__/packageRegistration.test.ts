import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import packageJson from '../../../package.json';

const registeredFiles = [
	...packageJson.n8n.credentials,
	...packageJson.n8n.nodes,
];

describe('n8n package registration', () => {
	it('only references built files that exist in the package', () => {
		const missingFiles = registeredFiles.filter((filePath) => !existsSync(resolve(filePath)));

		expect(missingFiles).toEqual([]);
	});

	it('does not register credential types already provided by n8n LangChain', () => {
		expect(packageJson.n8n.credentials).not.toEqual(
			expect.arrayContaining([
				'dist/credentials/OpenRouterApi.credentials.js',
				'dist/credentials/OllamaApi.credentials.js',
			]),
		);
	});
});
