import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { PROVIDER_DEFAULTS } from '../providerConfig';

const FALLBACK_OPTION: INodePropertyOptions = {
	name: 'Unable to Load Models - Type Alias Below',
	value: '',
	description: 'Use the Manual Model Alias field when the LiteLLM /v1/models endpoint is unavailable',
};

interface LiteLlmCredentials {
	apiKey?: string;
	authToken?: string;
	baseUrl?: string;
	url?: string;
}

function normalizeLiteLlmBaseUrl(value: string | undefined): string {
	const raw = (value ?? '').trim() || PROVIDER_DEFAULTS.liteLlmBaseUrl;
	return raw.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function readCurrentParameter(ctx: ILoadOptionsFunctions, name: string): string {
	try {
		return String(ctx.getCurrentNodeParameter(name) ?? '').trim();
	} catch {
		return '';
	}
}

function responseDataItems(response: unknown): unknown[] {
	if (Array.isArray(response)) {
		return response;
	}
	if (!response || typeof response !== 'object') {
		return [];
	}
	const data = (response as Record<string, unknown>).data;
	return Array.isArray(data) ? data : [];
}

function modelIdFromItem(item: unknown): string {
	if (!item || typeof item !== 'object') {
		return '';
	}
	const id = (item as Record<string, unknown>).id;
	return typeof id === 'string' ? id.trim() : '';
}

function prependStoredAlias(
	options: INodePropertyOptions[],
	storedAlias: string,
): INodePropertyOptions[] {
	if (!storedAlias || options.some((option) => option.value === storedAlias)) {
		return options;
	}
	return [
		{
			name: `${storedAlias} (Configured)`,
			value: storedAlias,
			description: 'Saved LiteLLM model alias that is not currently listed by /v1/models',
		},
		...options,
	];
}

export function parseLiteLlmModelOptions(response: unknown): INodePropertyOptions[] {
	const aliases = new Set<string>();
	for (const item of responseDataItems(response)) {
		const id = modelIdFromItem(item);
		if (id) {
			aliases.add(id);
		}
	}

	return [...aliases]
		.sort((left, right) => left.localeCompare(right))
		.map((alias) => ({
			name: alias,
			value: alias,
		}));
}

export async function listLiteLlmModelsLoadOption(
	ctx: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const storedAlias = readCurrentParameter(ctx, 'liteLlmModel');
	let credentials: LiteLlmCredentials | undefined;
	try {
		credentials = await ctx.getCredentials('claudeAgentSdkLiteLlmApi') as LiteLlmCredentials;
	} catch {
		return prependStoredAlias([FALLBACK_OPTION], storedAlias);
	}

	const apiKey = (credentials.apiKey || credentials.authToken || '').trim();
	if (!apiKey) {
		return prependStoredAlias([FALLBACK_OPTION], storedAlias);
	}

	try {
		const baseUrl = normalizeLiteLlmBaseUrl(credentials.baseUrl || credentials.url);
		const response = await ctx.helpers.httpRequest({
			method: 'GET',
			url: `${baseUrl}/v1/models`,
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			json: true,
		});
		const options = parseLiteLlmModelOptions(response);
		if (options.length === 0) {
			return prependStoredAlias([FALLBACK_OPTION], storedAlias);
		}
		return prependStoredAlias(options, storedAlias);
	} catch {
		return prependStoredAlias([FALLBACK_OPTION], storedAlias);
	}
}
