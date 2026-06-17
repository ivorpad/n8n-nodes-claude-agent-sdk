import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

import { claudeAgentWoztellDescription } from './node/description';
import { execute } from './node/execute';
import { webhook } from './node/webhook';

// eslint-disable-next-line @n8n/community-nodes/icon-validation
export class ClaudeAgentWoztell implements INodeType {
	description = claudeAgentWoztellDescription;

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return execute.call(this);
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		return webhook.call(this);
	}
}
