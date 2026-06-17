import { z } from 'zod';

import {
	STREAM_EVENT_TYPES,
	STREAM_STATUSES,
	TERMINAL_STREAM_STATUSES,
} from './streamTypes';

const dateInputSchema = z.union([
	z.date(),
	z.string().datetime({ offset: true }),
]);

const booleanInputSchema = z.preprocess((value) => {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'true' || normalized === '1') return true;
		if (normalized === 'false' || normalized === '0' || normalized === '') return false;
	}
	return value;
}, z.boolean());

const StreamStatusSchema = z.enum(STREAM_STATUSES);

const TerminalStreamStatusSchema = z.enum(TERMINAL_STREAM_STATUSES);

const StreamEventTypeSchema = z.enum(STREAM_EVENT_TYPES);

const StreamFramePayloadSchema = z.object({
	content: z.unknown(),
});

export const StreamFrameSchema = z.object({
	streamKey: z.string().trim().min(1).max(255),
	seq: z.number().int().positive(),
	eventType: StreamEventTypeSchema,
	createdAt: z.string().datetime({ offset: true }),
	payload: StreamFramePayloadSchema.nullable(),
	workflowId: z.string().trim().min(1).max(255).optional(),
	executionId: z.string().trim().min(1).max(255).optional(),
	chatSessionId: z.string().trim().min(1).max(255).optional(),
	requestId: z.string().trim().min(1).max(255).optional(),
});

export const StreamStateSchema = z.object({
	streamKey: z.string().trim().min(1).max(255),
	status: StreamStatusSchema,
	lastSeq: z.number().int().min(0),
	nextSeq: z.number().int().positive(),
	createdAt: z.string().datetime({ offset: true }),
	updatedAt: z.string().datetime({ offset: true }),
	workflowId: z.string().trim().min(1).max(255).optional(),
	executionId: z.string().trim().min(1).max(255).optional(),
	chatSessionId: z.string().trim().min(1).max(255).optional(),
	requestId: z.string().trim().min(1).max(255).optional(),
	terminalAt: z.string().datetime({ offset: true }).optional(),
	expiresAt: z.string().datetime({ offset: true }).optional(),
	errorMessage: z.string().trim().min(1).max(4000).optional(),
});

export const ReplayQuerySchema = z.object({
	streamKey: z.string().trim().min(1).max(255),
	cursor: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(2000).default(500),
	tailLive: booleanInputSchema.default(false),
});

export const TerminalTransitionSchema = z.object({
	streamKey: z.string().trim().min(1).max(255),
	status: TerminalStreamStatusSchema,
	at: dateInputSchema.optional(),
	errorMessage: z.string().trim().min(1).max(4000).optional(),
});

export const EnsureStreamInputSchema = z.object({
	streamKey: z.string().trim().min(1).max(255),
	status: StreamStatusSchema.default('live'),
	workflowId: z.string().trim().min(1).max(255).optional(),
	executionId: z.string().trim().min(1).max(255).optional(),
	chatSessionId: z.string().trim().min(1).max(255).optional(),
	requestId: z.string().trim().min(1).max(255).optional(),
	createdAt: dateInputSchema.optional(),
});

export const AppendStreamFrameInputSchema = z.object({
	streamKey: z.string().trim().min(1).max(255),
	eventType: StreamEventTypeSchema,
	payload: StreamFramePayloadSchema.nullable().optional(),
	workflowId: z.string().trim().min(1).max(255).optional(),
	executionId: z.string().trim().min(1).max(255).optional(),
	chatSessionId: z.string().trim().min(1).max(255).optional(),
	requestId: z.string().trim().min(1).max(255).optional(),
	createdAt: dateInputSchema.optional(),
});
