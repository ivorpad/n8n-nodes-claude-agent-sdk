import type { ChunkType } from 'n8n-workflow';

export const STREAM_STATUSES = [
	'live',
	'paused_hitl',
	'completed',
	'failed',
	'expired',
] as const;

export const TERMINAL_STREAM_STATUSES = [
	'paused_hitl',
	'completed',
	'failed',
	'expired',
] as const;

export const STREAM_EVENT_TYPES = [
	'begin',
	'item',
	'end',
	'error',
] as const satisfies readonly ChunkType[];

export type StreamStatus = typeof STREAM_STATUSES[number];
type TerminalStreamStatus = typeof TERMINAL_STREAM_STATUSES[number];
export type StreamEventType = typeof STREAM_EVENT_TYPES[number];

export interface StreamFramePayload {
	content: unknown;
}

export interface StreamFrame {
	streamKey: string;
	seq: number;
	eventType: StreamEventType;
	createdAt: string;
	payload: StreamFramePayload | null;
	workflowId?: string;
	executionId?: string;
	chatSessionId?: string;
	requestId?: string;
}

export interface ReplayQuery {
	streamKey: string;
	cursor?: number;
	limit?: number;
	tailLive?: boolean;
}

export interface ReplayResult {
	streamKey: string;
	status: StreamStatus;
	framesReplayed: number;
	lastSeq: number;
	liveAttached: boolean;
}

export interface StreamState {
	streamKey: string;
	status: StreamStatus;
	lastSeq: number;
	nextSeq: number;
	createdAt: string;
	updatedAt: string;
	workflowId?: string;
	executionId?: string;
	chatSessionId?: string;
	requestId?: string;
	terminalAt?: string;
	expiresAt?: string;
	errorMessage?: string;
}

export interface EnsureStreamArgs {
	streamKey: string;
	status?: StreamStatus;
	workflowId?: string;
	executionId?: string;
	chatSessionId?: string;
	requestId?: string;
	createdAt?: Date;
}

export interface AppendStreamFrameArgs {
	streamKey: string;
	eventType: StreamEventType;
	payload?: StreamFramePayload | null;
	workflowId?: string;
	executionId?: string;
	chatSessionId?: string;
	requestId?: string;
	createdAt?: Date;
}

export interface MarkStreamTerminalArgs {
	streamKey: string;
	status: TerminalStreamStatus;
	at?: Date;
	errorMessage?: string;
}
