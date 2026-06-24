/**
 * Claude Agent SDK Node
 *
 * Execute autonomous AI coding tasks using Claude Agent SDK.
 *
 * Keep this file small: implementation is split into `nodes/ClaudeAgentSdk/node/*`.
 */

import type {
	EngineRequest,
	EngineResponse,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodeExecutionData,
	INodePropertyOptions,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { Node } from 'n8n-workflow';

import {
	listManagedAgentsLoadOption,
	listManagedEnvironmentsLoadOption,
} from './managedAgent';
import { listCompanionAgentsLoadOption, listCompanionAgentsSearch } from './companion/loadOptions';
import { listLiteLlmModelsLoadOption } from './liteLlm/loadOptions';
import { listCodeMieModelsLoadOption } from './codemie/loadOptions';
import { claudeAgentSdkDescription } from './node/description';
import { execute } from './node/execute';
import { webhook } from './node/webhook';
import { discoverSkills } from './skills/discover';
import { discoverPlugins } from './skills/discoverPlugins';
import { loadToolOptions } from './toolOptions';

export { setExecutionContext } from './node/errors';

export class ClaudeAgentSdk extends Node {
	description = claudeAgentSdkDescription;

	// Not in Node's type definition but n8n runtime reads it via property access.
	methods = {
		loadOptions: {
			async discoverSkills(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const workingDirectory = this.getNodeParameter('workingDirectory', '') as string;
				const skills = await discoverSkills(workingDirectory || undefined);
				if (skills.length === 0) {
					return [{ name: 'No Skills Found', value: '__none__' }];
				}
				return skills.map((s) => {
					let desc = s.description;
					if (desc && desc.length > 80) {
						desc = desc.slice(0, 77) + '...';
					}
					return {
						name: desc
							? `${s.name} (${s.source}) \u2014 ${desc}`
							: `${s.name} (${s.source})`,
						value: s.name,
					};
				});
			},

			async discoverPlugins(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const workingDirectory = this.getNodeParameter('workingDirectory', '') as string;
				const plugins = await discoverPlugins(workingDirectory || undefined);
				if (plugins.length === 0) {
					return [{ name: 'No Plugins Found', value: '__none__' }];
				}
				return plugins.map((p) => {
					let desc = p.description;
					if (desc && desc.length > 80) {
						desc = desc.slice(0, 77) + '...';
					}
					return {
						name: desc
							? `${p.name}${p.version ? ` v${p.version}` : ''} \u2014 ${desc}`
							: `${p.name}${p.version ? ` v${p.version}` : ''}`,
						value: p.installPath,
					};
				});
			},

			async listToolOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await loadToolOptions(this);
			},

			async listManagedAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return listManagedAgentsLoadOption(this);
			},

			async listManagedEnvironments(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return listManagedEnvironmentsLoadOption(this);
			},

			async listCompanionAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return listCompanionAgentsLoadOption(this);
			},

			async listLiteLlmModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return listLiteLlmModelsLoadOption(this);
			},

			async listCodeMieModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return listCodeMieModelsLoadOption(this);
			},
		},
		listSearch: {
			async listCompanionAgents(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				return listCompanionAgentsSearch(this, filter);
			},
		},
	};

	async execute(
		context: IExecuteFunctions,
		response?: EngineResponse,
	): Promise<INodeExecutionData[][] | EngineRequest> {
		// n8n engine uses two calling conventions (see workflow-execute.js:557-561):
		//
		// New (extends Node, instanceof check passes):
		//   nodeType.execute(context, subNodeExecutionResults)
		//   → context = IExecuteFunctions, response = EngineResponse
		//
		// Legacy (implements INodeType, or instanceof fails due to different n8n-workflow copies):
		//   nodeType.execute.call(context, subNodeExecutionResults)
		//   → this = IExecuteFunctions, context = EngineResponse (first positional arg)
		//
		// Both conventions pass EngineResponse as the second argument in their own way.
		// We detect which convention by checking if `context` is IExecuteFunctions.
		const isNewConvention = context && typeof context.getInputData === 'function';
		let ctx: IExecuteFunctions;
		let engineResponse: EngineResponse | undefined;

		if (isNewConvention) {
			ctx = context;
			// n8n always passes subNodeExecutionResults — even on the first call it sends
			// an empty {actionResponses:[], metadata:{}}. Only treat it as a real resume
			// when there are actual action responses to process.
			engineResponse = (response && Array.isArray(response.actionResponses) && response.actionResponses.length > 0)
				? response
				: undefined;
		} else {
			ctx = this as unknown as IExecuteFunctions;
			// In legacy convention, `context` is actually the EngineResponse (subNodeExecutionResults)
			// Same empty-response guard as above.
			const maybeResponse = context as unknown as EngineResponse | undefined;
			engineResponse = (maybeResponse && Array.isArray(maybeResponse.actionResponses) && maybeResponse.actionResponses.length > 0)
				? maybeResponse
				: undefined;
		}

		return execute.call(ctx, engineResponse);
	}

	async webhook(context: IWebhookFunctions): Promise<IWebhookResponseData> {
		const ctx = (context && typeof context.getRequestObject === 'function')
			? context
			: (this as unknown as IWebhookFunctions);
		return webhook.call(ctx);
	}
}
