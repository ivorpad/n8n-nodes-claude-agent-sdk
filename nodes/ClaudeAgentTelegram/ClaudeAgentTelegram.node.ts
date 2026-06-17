import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

import { claudeAgentTelegramDescription } from './node/description';
import { execute } from './node/execute';
import { webhook } from './node/webhook';

export class ClaudeAgentTelegram implements INodeType {
	description = claudeAgentTelegramDescription;

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return execute.call(this);
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		return webhook.call(this);
	}
}
