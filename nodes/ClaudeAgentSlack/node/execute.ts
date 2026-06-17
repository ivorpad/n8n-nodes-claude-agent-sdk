import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import {
	executeCompanionNode,
	readChannelCompanionMessageSettings,
} from '../../ClaudeAgentChannelShared/core/executeRuntime';
import { savePending } from '../store/PendingSlackHitlStore';
import { sendApprovalMessage, sendQuestionMessage } from '../transport/slack';

export async function execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	return executeCompanionNode(this, {
		readMessageSettings: readChannelCompanionMessageSettings,
		savePending,
		sendApprovalMessage,
		sendQuestionMessage,
	});
}
