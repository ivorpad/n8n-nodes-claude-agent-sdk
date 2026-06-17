import type { HitlQuestionDefinition } from './contractTypes';
import type { HitlInteractionRecord } from './interactionStoreTypes';
import type { QueryableClient } from '../../shared/postgresTypes';
import {
	asNumber,
	buildSafeIndexName,
	quoteQualifiedTableName,
	validateExistingSchema as validateSchemaColumns,
} from '../../shared/postgresIdentifiers';

export type { QueryableClient } from '../../shared/postgresTypes';

// Re-exported so existing importers (e.g. PostgresHitlInteractionStore) keep
// their stable public surface after the helpers were centralized (P6).
export { buildSafeIndexName, quoteQualifiedTableName };

export type InteractionRow = {
	request_id: string;
	kind: 'approval' | 'question';
	status: 'pending' | 'answered';
	execution_id: string | null;
	chat_session_id: string | null;
	session_id: string | null;
	stream_key: string | null;
	original_task_base64: string | null;
	approved_fingerprints: string | null;
	timeout_ms: string | number;
	created_at_ms: string | number;
	answered_at_ms: string | number | null;
	decision_key: string | null;
	decision_id: string | null;
	decision_channel: string | null;
	resume_session_at: string | null;
	fingerprint: string | null;
	tool_name: string | null;
	tool_input: unknown;
	questions: unknown;
	answers: unknown;
	response_action: 'resume' | 'complete' | null;
	approved: boolean | null;
	permission_mode_override: string | null;
	reviewer_message: string | null;
	updated_input: unknown;
};

const REQUIRED_COLUMNS = [
	'workflow_id',
	'node_name',
	'request_id',
	'kind',
	'status',
	'execution_id',
	'chat_session_id',
	'session_id',
	'stream_key',
	'original_task_base64',
	'approved_fingerprints',
	'timeout_ms',
	'created_at_ms',
	'answered_at_ms',
	'decision_key',
	'decision_id',
	'decision_channel',
	'resume_session_at',
	'fingerprint',
	'tool_name',
	'tool_input',
	'questions',
	'answers',
	'response_action',
	'approved',
	'permission_mode_override',
	'reviewer_message',
	'updated_input',
	'updated_at',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asQuestionList(value: unknown): HitlQuestionDefinition[] | undefined {
	return Array.isArray(value) ? value as HitlQuestionDefinition[] : undefined;
}

function asAnswerMap(value: unknown): Record<string, string | string[]> | undefined {
	return isRecord(value) ? value as Record<string, string | string[]> : undefined;
}

export async function validateExistingSchema(
	client: QueryableClient,
	tableName: string,
): Promise<void> {
	await validateSchemaColumns(client, tableName, REQUIRED_COLUMNS, 'HITL interaction table');
}

export function mapInteractionRow(row: InteractionRow): HitlInteractionRecord {
	const base = {
		requestId: row.request_id,
		kind: row.kind,
		status: row.status,
		createdAt: asNumber(row.created_at_ms),
		timeoutMs: asNumber(row.timeout_ms),
		executionId: row.execution_id ?? undefined,
		chatSessionId: row.chat_session_id ?? undefined,
		sessionId: row.session_id ?? undefined,
		streamKey: row.stream_key ?? undefined,
		originalTaskBase64: row.original_task_base64 ?? undefined,
		approvedFingerprints: row.approved_fingerprints ?? undefined,
		resumeSessionAt: row.resume_session_at ?? undefined,
		answeredAt: row.answered_at_ms == null ? undefined : asNumber(row.answered_at_ms),
		decisionKey: row.decision_key ?? undefined,
		decisionId: row.decision_id ?? undefined,
		decisionChannel: row.decision_channel ?? undefined,
	};

	if (row.kind === 'approval') {
		return {
			...base,
			kind: 'approval',
			status: row.status,
			fingerprint: row.fingerprint ?? undefined,
			toolName: row.tool_name ?? undefined,
			toolInput: isRecord(row.tool_input) ? row.tool_input : undefined,
			approved: row.approved ?? undefined,
			permissionModeOverride: row.permission_mode_override ?? undefined,
			reviewerMessage: row.reviewer_message ?? undefined,
			updatedInput: isRecord(row.updated_input) ? row.updated_input : undefined,
		};
	}

	return {
		...base,
		kind: 'question',
		status: row.status,
		questions: asQuestionList(row.questions) ?? [],
		answers: asAnswerMap(row.answers),
		responseAction: row.response_action ?? undefined,
	};
}
