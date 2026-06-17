import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import {
	executeCompanionNode,
	readMailCompanionMessageSettings,
} from '../../ClaudeAgentChannelShared/core/executeRuntime';
import { savePending } from '../store/PendingGmailHitlStore';
import { sendApprovalMessage, sendQuestionMessage } from '../transport/gmail';

export async function execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	return executeCompanionNode(this, {
		readMessageSettings: readMailCompanionMessageSettings,
		savePending,
		sendApprovalMessage,
		sendQuestionMessage,
	});
}
