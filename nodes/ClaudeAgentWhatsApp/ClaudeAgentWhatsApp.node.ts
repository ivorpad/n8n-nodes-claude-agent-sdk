import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

import { claudeAgentWhatsAppDescription } from './node/description';
import { execute } from './node/execute';
import { webhook } from './node/webhook';

export class ClaudeAgentWhatsApp implements INodeType {
	description = claudeAgentWhatsAppDescription;

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return execute.call(this);
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		return webhook.call(this);
	}
}

