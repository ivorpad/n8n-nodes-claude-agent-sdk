import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

import { claudeAgentGmailDescription } from './node/description';
import { execute } from './node/execute';
import { webhook } from './node/webhook';

export class ClaudeAgentGmail implements INodeType {
	description = claudeAgentGmailDescription;

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return execute.call(this);
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		return webhook.call(this);
	}
}
