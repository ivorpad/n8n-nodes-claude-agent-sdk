import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../codemie/companion', () => ({
	isCodeMieAvailable: vi.fn(() => true),
	loadCodeMieCompanion: vi.fn(),
}));

import { isCodeMieAvailable, loadCodeMieCompanion } from '../../codemie/companion';
import { listCodeMieModelsLoadOption } from '../../codemie/loadOptions';

const mockedAvailable = isCodeMieAvailable as unknown as ReturnType<typeof vi.fn>;
const mockedLoad = loadCodeMieCompanion as unknown as ReturnType<typeof vi.fn>;

function makeContext(
	overrides: {
		credentials?: Record<string, unknown>;
		credentialError?: Error;
		current?: string;
	} = {},
): ILoadOptionsFunctions {
	return {
		getCredentials: overrides.credentialError
			? vi.fn().mockRejectedValue(overrides.credentialError)
			: vi.fn().mockResolvedValue(overrides.credentials ?? {}),
		getCurrentNodeParameter: vi.fn().mockReturnValue(overrides.current ?? ''),
	} as unknown as ILoadOptionsFunctions;
}

describe('listCodeMieModelsLoadOption', () => {
	beforeEach(() => {
		mockedAvailable.mockReturnValue(true);
		mockedLoad.mockReset();
	});

	it('lists models via the companion proxy when available', async () => {
		const ensureCodemieProxy = vi
			.fn()
			.mockResolvedValue({ url: 'http://127.0.0.1:4001', gatewayKey: 'codemie-proxy' });
		const fetchCodeMieModels = vi
			.fn()
			.mockResolvedValue([{ id: 'claude-sonnet-4-5-20250929', label: 'Sonnet' }]);
		mockedLoad.mockReturnValue({ ensureCodemieProxy, fetchCodeMieModels, buildLoginUrl: vi.fn() });

		const result = await listCodeMieModelsLoadOption(
			makeContext({ credentials: { instanceUrl: 'https://codemie.lab.epam.com' } }),
		);

		expect(result).toEqual([
			{ name: 'Sonnet (claude-sonnet-4-5-20250929)', value: 'claude-sonnet-4-5-20250929' },
		]);
		expect(ensureCodemieProxy).toHaveBeenCalledWith({
			instanceUrl: 'https://codemie.lab.epam.com',
		});
	});

	it('keeps a saved model visible and offers manual entry when the companion is absent', async () => {
		mockedAvailable.mockReturnValue(false);
		const result = await listCodeMieModelsLoadOption(
			makeContext({ credentials: { instanceUrl: 'https://x' }, current: 'saved-model' }),
		);

		expect(result[0]).toMatchObject({ name: 'saved-model (Configured)', value: 'saved-model' });
		expect(result.some((option) => option.value === '')).toBe(true);
	});

	it('falls back to manual entry when no Instance URL is configured', async () => {
		const result = await listCodeMieModelsLoadOption(makeContext({ credentials: {} }));
		expect(result).toEqual([expect.objectContaining({ value: '' })]);
	});

	it('falls back to manual entry when the proxy/model fetch fails', async () => {
		mockedLoad.mockReturnValue({
			ensureCodemieProxy: vi.fn().mockRejectedValue(new Error('proxy down')),
			fetchCodeMieModels: vi.fn(),
			buildLoginUrl: vi.fn(),
		});
		const result = await listCodeMieModelsLoadOption(
			makeContext({ credentials: { instanceUrl: 'https://x' } }),
		);
		expect(result).toEqual([expect.objectContaining({ value: '' })]);
	});
});
