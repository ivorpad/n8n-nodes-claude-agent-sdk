import type {
	ApprovalChunkQuestion,
	ApprovalChunkV1Expired,
	ApprovalChunkV1Request,
	ApprovalChunkV1Response,
	ApprovalResponseContent,
	AskUserQuestionContent,
	PermissionRequestContent,
	StreamItemPayload,
	StreamingConfig,
} from '../types';

function buildToolSummary(toolName: string, input: Record<string, unknown>): string {
	// Common patterns for readable summaries
	if (toolName === 'Bash' && input.command) {
		const cmd = String(input.command);
		return cmd.length > 80 ? `${cmd.slice(0, 80)}...` : cmd;
	}
	if (toolName === 'Write' && input.file_path) {
		return `Write to ${input.file_path}`;
	}
	if (toolName === 'Edit' && input.file_path) {
		return `Edit ${input.file_path}`;
	}
	if (toolName === 'Read' && input.file_path) {
		return `Read ${input.file_path}`;
	}
	// MCP tools
	if (toolName.startsWith('mcp__')) {
		const parts = toolName.split('__');
		return parts.length >= 2 ? `MCP: ${parts.slice(1).join('.')}` : toolName;
	}
	// Default: show tool name with first key
	const firstKey = Object.keys(input)[0];
	if (firstKey && input[firstKey]) {
		const val = String(input[firstKey]);
		return val.length > 60 ? `${val.slice(0, 60)}...` : val;
	}
	return toolName;
}

function buildToolApprovalChunk(payload: PermissionRequestContent): ApprovalChunkV1Request {
	return {
		schema: 'n8n.approval.v1',
		event: 'request',
		request: {
			id: payload.requestId,
			kind: 'tool_approval',
			sessionId: payload.sessionId,
			expiresAt: payload.expiresAt,
		},
		tool: {
			name: payload.toolName,
			useId: payload.toolUseId || undefined,
			input: payload.toolInput,
		},
		actions: {
			approveUrl: payload.approveUrl,
			denyUrl: payload.denyUrl,
		},
		display: {
			title: `Approve ${payload.toolName}?`,
			summary: buildToolSummary(payload.toolName, payload.toolInput),
		},
	};
}

function buildQuestionChunk(payload: AskUserQuestionContent): ApprovalChunkV1Request {
	const questions: ApprovalChunkQuestion[] = payload.questions;

	return {
		schema: 'n8n.approval.v1',
		event: 'request',
		request: {
			id: payload.requestId,
			kind: 'user_question',
			sessionId: payload.sessionId,
			expiresAt: payload.expiresAt,
		},
		questions,
		actions: {
			responseUrl: payload.responseUrl,
		},
		display: {
			title: questions[0]?.header || 'Question',
			summary: questions[0]?.question,
		},
	};
}

function emitUacChunk(args: {
	config: StreamingConfig;
	stream: (content: string) => void;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
	markerType: string;
	chunk: Exclude<StreamItemPayload, string>;
}): void {
	const { config, stream, emitJson, formatMarker, markerType, chunk } = args;

	if (config.useMarkers) {
		const marker = formatMarker(config.markers.jsonMsgStart, { type: markerType });
		stream(`\n${marker}${JSON.stringify(chunk)}${config.markers.jsonMsgEnd}\n`);
	} else {
		emitJson(chunk);
	}
}

export function streamPermissionRequestUacV1(args: {
	config: StreamingConfig;
	stream: (content: string) => void;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
	payload: PermissionRequestContent;
}): void {
	const { config, stream, emitJson, formatMarker, payload } = args;
	const uacChunk = buildToolApprovalChunk(payload);
	emitUacChunk({ config, stream, emitJson, formatMarker, markerType: 'approval_request', chunk: uacChunk });
}

export function streamAskUserQuestionUacV1(args: {
	config: StreamingConfig;
	stream: (content: string) => void;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
	payload: AskUserQuestionContent;
}): void {
	const { config, stream, emitJson, formatMarker, payload } = args;
	const uacChunk = buildQuestionChunk(payload);
	emitUacChunk({ config, stream, emitJson, formatMarker, markerType: 'approval_request', chunk: uacChunk });
}

export function streamApprovalResponseUacV1(args: {
	config: StreamingConfig;
	stream: (content: string) => void;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
	payload: ApprovalResponseContent;
}): void {
	const { config, stream, emitJson, formatMarker, payload } = args;

	const uacChunk: ApprovalChunkV1Response = {
		schema: 'n8n.approval.v1',
		event: 'response',
		request: {
			id: payload.requestId,
			kind: 'tool_approval', // Default to tool_approval; could be extended
			sessionId: payload.sessionId ?? null,
		},
		approved: payload.approved,
		timestamp: payload.timestamp,
	};

	emitUacChunk({ config, stream, emitJson, formatMarker, markerType: 'approval_response', chunk: uacChunk });
}

export function streamApprovalExpiredUacV1(args: {
	config: StreamingConfig;
	stream: (content: string) => void;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
	requestId: string;
	kind: 'tool_approval' | 'user_question';
	sessionId: string;
}): void {
	const { config, stream, emitJson, formatMarker, requestId, kind, sessionId } = args;

	const uacChunk: ApprovalChunkV1Expired = {
		schema: 'n8n.approval.v1',
		event: 'expired',
		request: {
			id: requestId,
			kind,
			sessionId,
		},
		timestamp: new Date().toISOString(),
	};

	emitUacChunk({ config, stream, emitJson, formatMarker, markerType: 'approval_expired', chunk: uacChunk });
}
