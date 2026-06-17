/**
 * Notification Types for HITL approval channels
 */

import type { HitlQuestionDefinition } from '../hitl/contractTypes';

export type AskUserQuestionArray = HitlQuestionDefinition[];

export interface ApprovalNotification {
	requestId: string;
	toolName: string;
	toolInput: Record<string, unknown>;
	approveUrl: string;
	denyUrl: string;
	expiresAt: string;
	sessionId?: string;
	message?: string;
}

export interface QuestionNotification {
	requestId: string;
	questions: AskUserQuestionArray;
	responseUrl: string;
	expiresAt: string;
	sessionId?: string;
}

export interface NotificationChannel {
	name: string;
	sendApproval(notification: ApprovalNotification): Promise<void>;
	sendQuestion(notification: QuestionNotification): Promise<void>;
}
