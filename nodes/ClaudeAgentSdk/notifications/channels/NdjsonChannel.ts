/**
 * NdjsonChannel - Emit approval notifications via NDJSON streaming
 *
 * Wraps the existing StreamingHandler to send approval requests
 * through the NDJSON stream output.
 */

import type { StreamingHandler } from '../../streaming/StreamingHandler';
import type { NotificationChannel, ApprovalNotification, QuestionNotification } from '../types';

export class NdjsonChannel implements NotificationChannel {
	name = 'ndjson';

	constructor(private streamHandler: StreamingHandler) {}

	async sendApproval(notification: ApprovalNotification): Promise<void> {
		this.streamHandler.streamPermissionRequest({
			type: 'permission_request',
			requestId: notification.requestId,
			toolName: notification.toolName,
			toolUseId: '',
			toolInput: notification.toolInput,
			sessionId: notification.sessionId || '',
			approveUrl: notification.approveUrl,
			denyUrl: notification.denyUrl,
			expiresAt: notification.expiresAt,
		});
	}

	async sendQuestion(notification: QuestionNotification): Promise<void> {
		this.streamHandler.streamAskUserQuestion({
			type: 'ask_user_question',
			requestId: notification.requestId,
			toolUseId: '',
			questions: notification.questions,
			sessionId: notification.sessionId || '',
			responseUrl: notification.responseUrl,
			expiresAt: notification.expiresAt,
		});
	}
}
