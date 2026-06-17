import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

import { claudeAgentDiscordDescription } from './node/description';
import { execute } from './node/execute';
import { webhook } from './node/webhook';

export class ClaudeAgentDiscord implements INodeType {
	description = claudeAgentDiscordDescription;

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return execute.call(this);
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		return webhook.call(this);
	}
}
