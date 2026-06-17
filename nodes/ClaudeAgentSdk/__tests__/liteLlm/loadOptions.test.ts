import type { ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import {
	listLiteLlmModelsLoadOption,
	parseLiteLlmModelOptions,
} from '../../liteLlm/loadOptions';

function makeLoadOptionsContext(overrides: {
	credentials?: Record<string, unknown>;
	currentAlias?: string;
	response?: unknown;
	httpError?: Error;
	credentialError?: Error;
} = {}): ILoadOptionsFunctions {
	const httpRequest = overrides.httpError
		? vi.fn().mockRejectedValue(overrides.httpError)
		: vi.fn().mockResolvedValue(overrides.response ?? { data: [] });
	const getCredentials = overrides.credentialError
		? vi.fn().mockRejectedValue(overrides.credentialError)
		: vi.fn().mockResolvedValue(overrides.credentials ?? {});

	return {
		getCredentials,
		getCurrentNodeParameter: vi.fn().mockReturnValue(overrides.currentAlias ?? ''),
		helpers: {
			httpRequest,
		},
	} as unknown as ILoadOptionsFunctions;
}

describe('LiteLLM model load options', () => {
	it('parses and sorts model aliases from /v1/models responses', () => {
		expect(
			parseLiteLlmModelOptions({
				data: [
					{ id: 'claude-sonnet' },
					{ id: 'claude-opus' },
					{ id: '' },
					{ name: 'missing-id' },
					{ id: 'claude-sonnet' },
				],
			}),
		).toEqual([
			{ name: 'claude-opus', value: 'claude-opus' },
			{ name: 'claude-sonnet', value: 'claude-sonnet' },
		]);
	});

	it('loads aliases with bearer auth and normalizes trailing /v1 base URLs', async () => {
		const ctx = makeLoadOptionsContext({
			credentials: {
				apiKey: 'litellm-key',
				baseUrl: 'http://localhost:4000/v1/',
			},
			response: {
				data: [
					{ id: 'claude-sonnet' },
					{ id: 'claude-opus' },
				],
			},
		});

		await expect(listLiteLlmModelsLoadOption(ctx)).resolves.toEqual([
			{ name: 'claude-opus', value: 'claude-opus' },
			{ name: 'claude-sonnet', value: 'claude-sonnet' },
		]);
		expect(ctx.helpers.httpRequest).toHaveBeenCalledWith({
			method: 'GET',
			url: 'http://localhost:4000/v1/models',
			headers: {
				Authorization: 'Bearer litellm-key',
			},
			json: true,
		});
	});

	it('keeps a saved alias visible when it is not listed by the proxy', async () => {
		const ctx = makeLoadOptionsContext({
			credentials: {
				apiKey: 'litellm-key',
				baseUrl: 'http://localhost:4000',
			},
			currentAlias: 'saved-alias',
			response: {
				data: [{ id: 'listed-alias' }],
			},
		});

		await expect(listLiteLlmModelsLoadOption(ctx)).resolves.toEqual([
			{
				name: 'saved-alias (Configured)',
				value: 'saved-alias',
				description: 'Saved LiteLLM model alias that is not currently listed by /v1/models',
			},
			{ name: 'listed-alias', value: 'listed-alias' },
		]);
	});

	it('falls back to manual alias entry when credentials or model loading are unavailable', async () => {
		const missingCredentialCtx = makeLoadOptionsContext({
			currentAlias: 'saved-alias',
			credentialError: new Error('missing credential'),
		});
		const failedHttpCtx = makeLoadOptionsContext({
			credentials: {
				apiKey: 'litellm-key',
				baseUrl: 'http://localhost:4000',
			},
			httpError: new Error('proxy unavailable'),
		});

		await expect(listLiteLlmModelsLoadOption(missingCredentialCtx)).resolves.toEqual([
			{
				name: 'saved-alias (Configured)',
				value: 'saved-alias',
				description: 'Saved LiteLLM model alias that is not currently listed by /v1/models',
			},
			{
				name: 'Unable to Load Models - Type Alias Below',
				value: '',
				description: 'Use the Manual Model Alias field when the LiteLLM /v1/models endpoint is unavailable',
			},
		]);
		await expect(listLiteLlmModelsLoadOption(failedHttpCtx)).resolves.toEqual([
			{
				name: 'Unable to Load Models - Type Alias Below',
				value: '',
				description: 'Use the Manual Model Alias field when the LiteLLM /v1/models endpoint is unavailable',
			},
		]);
	});
});
