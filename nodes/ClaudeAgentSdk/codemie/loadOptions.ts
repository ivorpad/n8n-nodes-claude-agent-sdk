/**
 * Load options for the CodeMie Proxy provider, mirroring the LiteLLM model
 * loader. The Model dropdown reads the selected CodeMie SSO credential, starts/
 * reuses the proxy via the companion, and lists models. (The login URL is
 * surfaced by the credential's Test button, not a node field.)
 */

import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { isCodeMieAvailable, loadCodeMieCompanion } from './companion';

interface CodeMieCredentials {
	instanceUrl?: string;
}

const MANUAL_FALLBACK_OPTION: INodePropertyOptions = {
	name: 'Unable to Load Models - Type Model Below',
	value: '',
	description:
		'Use the Manual Model field when the CodeMie proxy is unavailable or the SSO session has expired',
};

function readCurrentParameter(ctx: ILoadOptionsFunctions, name: string): string {
	try {
		return String(ctx.getCurrentNodeParameter(name) ?? '').trim();
	} catch {
		return '';
	}
}

function prependStoredModel(
	options: INodePropertyOptions[],
	storedModel: string,
): INodePropertyOptions[] {
	if (!storedModel || options.some((option) => option.value === storedModel)) {
		return options;
	}
	return [
		{
			name: `${storedModel} (Configured)`,
			value: storedModel,
			description: 'Saved CodeMie model that is not currently listed by the proxy',
		},
		...options,
	];
}

async function readInstanceUrl(ctx: ILoadOptionsFunctions): Promise<string> {
	try {
		const credentials = (await ctx.getCredentials('codeMieSsoApi')) as CodeMieCredentials;
		return (credentials.instanceUrl || '').trim();
	} catch {
		return '';
	}
}

export async function listCodeMieModelsLoadOption(
	ctx: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const storedModel = readCurrentParameter(ctx, 'codeMieModel');
	if (!isCodeMieAvailable()) {
		return prependStoredModel([MANUAL_FALLBACK_OPTION], storedModel);
	}

	const instanceUrl = await readInstanceUrl(ctx);
	if (!instanceUrl) {
		return prependStoredModel([MANUAL_FALLBACK_OPTION], storedModel);
	}

	try {
		const companion = loadCodeMieCompanion();
		const proxy = await companion.ensureCodemieProxy({ instanceUrl });
		const models = await companion.fetchCodeMieModels(proxy);
		const options: INodePropertyOptions[] = models.map((model) => ({
			name: model.label && model.label !== model.id ? `${model.label} (${model.id})` : model.id,
			value: model.id,
		}));
		if (options.length === 0) {
			return prependStoredModel([MANUAL_FALLBACK_OPTION], storedModel);
		}
		return prependStoredModel(options, storedModel);
	} catch {
		return prependStoredModel([MANUAL_FALLBACK_OPTION], storedModel);
	}
}
