/**
 * Message processing utilities for executeTask operation
 */

import type { ToolCall } from '../../types';
import type {
	ManagedSessionFilesMessage,
	SDKPermissionDenial,
	SDKSystemMessage,
	TerminalReason,
	SDKDeferredToolUse,
} from '../../sdk/types';
import type { ProcessedMessages, ExecutionUsage, ModelUsageEntry } from './types';
import type { SecretsRedactor } from './secretsRedaction';

type UsageWarningCollector = string[];

interface MessageHandlerInput {
	originalMessage: unknown;
	message: Record<string, unknown>;
	processed: ProcessedMessages;
	redactor?: SecretsRedactor;
}

type MessageHandler = (input: MessageHandlerInput) => void;

const MODEL_USAGE_NUMERIC_FIELDS = [
	'inputTokens',
	'outputTokens',
	'cacheReadInputTokens',
	'cacheCreationInputTokens',
	'webSearchRequests',
	'costUSD',
	'contextWindow',
	'maxOutputTokens',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pushToolCall(
	toolCalls: ToolCall[],
	toolName: unknown,
	toolInput: unknown,
	redactor?: SecretsRedactor,
): void {
	if (typeof toolName !== 'string' || toolName.trim().length === 0) {
		return;
	}

	toolCalls.push({
		tool: toolName,
		input: redactor ? redactor.redactUnknown(toolInput) : toolInput,
	});
}

function getAssistantContentBlocks(
	message: Record<string, unknown>,
): Array<Record<string, unknown>> {
	if (message.type !== 'assistant') {
		return [];
	}

	const assistantMessage = message.message as Record<string, unknown> | undefined;
	const content = assistantMessage?.content;
	if (!Array.isArray(content)) {
		return [];
	}

	return content as Array<Record<string, unknown>>;
}

function extractAssistantToolCalls(
	message: Record<string, unknown>,
	toolCalls: ToolCall[],
	redactor?: SecretsRedactor,
): void {
	for (const contentBlock of getAssistantContentBlocks(message)) {
		if (contentBlock.type !== 'tool_use') {
			continue;
		}
		pushToolCall(toolCalls, contentBlock.name, contentBlock.input, redactor);
	}
}

function extractAssistantText(message: Record<string, unknown>): string[] {
	const texts: string[] = [];
	for (const contentBlock of getAssistantContentBlocks(message)) {
		if (contentBlock.type === 'text' && typeof contentBlock.text === 'string') {
			texts.push(contentBlock.text);
		}
	}
	return texts;
}

function createProcessedMessages(): ProcessedMessages {
	return {
		textMessages: [],
		artifacts: [],
		toolCalls: [],
		toolDenials: [],
		mcpServerStatus: [],
		sessionId: undefined,
		rawStructuredOutputResult: undefined,
		structuredOutputResult: undefined,
		resultSubtype: undefined,
		resultIsError: undefined,
		resultErrors: [],
		permissionDenials: [],
		executionUsage: undefined,
		terminalReason: undefined,
		deferredToolUse: undefined,
		stopReason: undefined,
		stopDetails: undefined,
		sessionFiles: undefined,
	};
}

function captureSessionIdCandidate(
	message: Record<string, unknown>,
	processed: ProcessedMessages,
): void {
	// Capture session_id — prefer system:init (authoritative) over hook/other messages
	if (message.session_id && !processed.sessionId) {
		processed.sessionId = message.session_id as string;
	}
}

function processSystemInitMessage(
	message: Record<string, unknown>,
	processed: ProcessedMessages,
): void {
	// system:init carries the authoritative session ID (matches resume on
	// continuation). Hook messages emitted before init may carry a
	// process-level ID that differs from the resumed session.
	if (message.session_id) {
		processed.sessionId = message.session_id as string;
	}
	processed.mcpServerStatus = (message.mcp_servers as SDKSystemMessage['mcp_servers']) || [];
}

function processArtifactMessage(
	message: unknown,
	processed: ProcessedMessages,
	redactor?: SecretsRedactor,
): void {
	processed.artifacts.push(redactor ? redactor.redactUnknown(message) : message);
}

function formatToolDenialReason(content: unknown) {
	if (typeof content === 'string') {
		return content;
	}

	if (!Array.isArray(content)) {
		return JSON.stringify(content);
	}

	const textReason = (content as Array<Record<string, unknown>>)
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text as string)
		.join('\n');

	return textReason || JSON.stringify(content);
}

/**
 * Tool denials arrive as user messages carrying tool_result blocks with
 * is_error: true (canonical shape — there is no top-level 'tool_result'
 * message type in the SDK union). HITL pause/deny coordination noise is
 * skipped so only real tool failures surface as denials.
 */
function processUserToolDenials(
	message: Record<string, unknown>,
	processed: ProcessedMessages,
): void {
	const userMessage = message.message as Record<string, unknown> | undefined;
	const content = userMessage?.content;
	if (!Array.isArray(content)) {
		return;
	}
	for (const rawBlock of content) {
		const block = rawBlock as Record<string, unknown>;
		if (block.type !== 'tool_result' || block.is_error !== true) {
			continue;
		}
		const reason = formatToolDenialReason(block.content);
		if (reason.includes('[HITL]') || reason.includes('User rejected tool use')) {
			continue;
		}
		processed.toolDenials.push({
			tool: typeof block.tool_use_id === 'string' ? block.tool_use_id : 'unknown',
			reason,
		});
	}
}

function processAssistantMessage(
	message: Record<string, unknown>,
	processed: ProcessedMessages,
	redactor?: SecretsRedactor,
): void {
	captureStopMetadata(message, processed, redactor);
	extractAssistantToolCalls(message, processed.toolCalls, redactor);
	for (const text of extractAssistantText(message)) {
		processed.textMessages.push(redactor ? redactor.redactString(text) : text);
	}
}

function describeUsageValue(value: unknown): string {
	if (typeof value === 'number') {
		return Number.isNaN(value) ? 'NaN' : String(value);
	}
	if (value === null) {
		return 'null';
	}
	return typeof value;
}

function numberFieldOrZero(
	record: Record<string, unknown> | undefined,
	key: string,
	fieldPath: string,
	warnings: UsageWarningCollector,
): number {
	if (!record || !Object.prototype.hasOwnProperty.call(record, key)) {
		return 0;
	}

	const value = record[key];
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	warnings.push(
		`Malformed SDK usage field "${fieldPath}" (${describeUsageValue(value)}); defaulted to 0.`,
	);
	return 0;
}

function createModelUsageEntry(
	model: string,
	usage: Record<string, unknown>,
	warnings: UsageWarningCollector,
): ModelUsageEntry {
	const entry: Record<string, unknown> = { ...usage };
	for (const field of MODEL_USAGE_NUMERIC_FIELDS) {
		entry[field] = numberFieldOrZero(usage, field, `modelUsage.${model}.${field}`, warnings);
	}
	return entry as ModelUsageEntry;
}

function buildModelUsageEntries(
	sdkModelUsage: unknown,
	warnings: UsageWarningCollector,
): Record<string, ModelUsageEntry> {
	if (sdkModelUsage === undefined) {
		return {};
	}

	if (!isRecord(sdkModelUsage)) {
		warnings.push(
			`Malformed SDK usage field "modelUsage" (${describeUsageValue(sdkModelUsage)}); defaulted to empty object.`,
		);
		return {};
	}

	const entries: Record<string, ModelUsageEntry> = {};
	for (const [model, usage] of Object.entries(sdkModelUsage)) {
		if (!isRecord(usage)) {
			warnings.push(
				`Malformed SDK usage field "modelUsage.${model}" (${describeUsageValue(usage)}); defaulted to 0-valued usage entry.`,
			);
			entries[model] = createModelUsageEntry(model, {}, warnings);
			continue;
		}
		entries[model] = createModelUsageEntry(model, usage, warnings);
	}

	return entries;
}

function extractExecutionUsage(message: Record<string, unknown>): ExecutionUsage {
	const warnings: UsageWarningCollector = [];
	const rawUsage = message.usage;
	const sdkUsage = rawUsage === undefined
		? undefined
		: isRecord(rawUsage)
			? rawUsage
			: undefined;

	if (rawUsage !== undefined && !isRecord(rawUsage)) {
		warnings.push(
			`Malformed SDK usage field "usage" (${describeUsageValue(rawUsage)}); defaulted to empty object.`,
		);
	}

	return {
		totalCostUsd: numberFieldOrZero(message, 'total_cost_usd', 'total_cost_usd', warnings),
		numTurns: numberFieldOrZero(message, 'num_turns', 'num_turns', warnings),
		durationMs: numberFieldOrZero(message, 'duration_ms', 'duration_ms', warnings),
		durationApiMs: numberFieldOrZero(message, 'duration_api_ms', 'duration_api_ms', warnings),
		usage: {
			inputTokens: numberFieldOrZero(sdkUsage, 'input_tokens', 'usage.input_tokens', warnings),
			outputTokens: numberFieldOrZero(sdkUsage, 'output_tokens', 'usage.output_tokens', warnings),
			cacheReadInputTokens: numberFieldOrZero(
				sdkUsage,
				'cache_read_input_tokens',
				'usage.cache_read_input_tokens',
				warnings,
			),
			cacheCreationInputTokens: numberFieldOrZero(
				sdkUsage,
				'cache_creation_input_tokens',
				'usage.cache_creation_input_tokens',
				warnings,
			),
		},
		modelUsage: buildModelUsageEntries(message.modelUsage, warnings),
		...(warnings.length > 0 ? { warnings } : {}),
	};
}

function captureStructuredOutput(
	message: Record<string, unknown>,
	processed: ProcessedMessages,
	redactor?: SecretsRedactor,
): void {
	if (message.structured_output !== undefined) {
		processed.rawStructuredOutputResult = message.structured_output;
		processed.structuredOutputResult = redactor
			? redactor.redactUnknown(message.structured_output)
			: message.structured_output;
	}
}

function captureTerminalReason(
	message: Record<string, unknown>,
	processed: ProcessedMessages,
): void {
	// Capture terminal reason and deferred tool payload (SDK 0.2.92+)
	if (typeof message.terminal_reason === 'string') {
		processed.terminalReason = message.terminal_reason as TerminalReason;
	}
}

function captureDeferredToolUse(
	message: Record<string, unknown>,
	processed: ProcessedMessages,
	redactor?: SecretsRedactor,
): void {
	if (processed.terminalReason === 'tool_deferred' && message.deferred_tool_use) {
		processed.deferredToolUse = redactor
			? (redactor.redactUnknown(message.deferred_tool_use) as SDKDeferredToolUse)
			: (message.deferred_tool_use as SDKDeferredToolUse);
	}
}

function readNestedMessage(message: Record<string, unknown>): Record<string, unknown> | undefined {
	const nested = message.message;
	return nested && typeof nested === 'object' && !Array.isArray(nested)
		? (nested as Record<string, unknown>)
		: undefined;
}

/**
 * stop_reason/stop_details live TOP-LEVEL on canonical result messages
 * (incl. managed results since the eventMapper rewrite); the nested
 * message.stop_reason fallback stays for CLI assistant refusal envelopes
 * (BetaMessage.stop_reason inside assistant messages).
 */
function captureStopMetadata(
	message: Record<string, unknown>,
	processed: ProcessedMessages,
	redactor?: SecretsRedactor,
): void {
	const nested = readNestedMessage(message);
	const stopReason = typeof message.stop_reason === 'string'
		? message.stop_reason
		: typeof nested?.stop_reason === 'string'
			? nested.stop_reason
			: undefined;
	const stopDetails = message.stop_details ?? nested?.stop_details;

	if (stopReason) {
		processed.stopReason = stopReason;
	}
	if (stopDetails !== undefined) {
		processed.stopDetails = redactor ? redactor.redactUnknown(stopDetails) : stopDetails;
	}
}

function processResultMessage(
	message: Record<string, unknown>,
	processed: ProcessedMessages,
	redactor?: SecretsRedactor,
): void {
	processed.resultSubtype = message.subtype as string | undefined;
	// Canonical result diagnostics — preferred over regex text heuristics.
	if (typeof message.is_error === 'boolean') {
		processed.resultIsError = message.is_error;
	}
	if (Array.isArray(message.errors)) {
		processed.resultErrors = (message.errors as unknown[])
			.filter((entry): entry is string => typeof entry === 'string')
			.map((entry) => (redactor ? redactor.redactString(entry) : entry));
	}
	if (Array.isArray(message.permission_denials)) {
		processed.permissionDenials = (redactor
			? (redactor.redactUnknown(message.permission_denials) as SDKPermissionDenial[])
			: (message.permission_denials as SDKPermissionDenial[]));
	}
	captureStopMetadata(message, processed, redactor);
	captureStructuredOutput(message, processed, redactor);
	captureTerminalReason(message, processed);
	captureDeferredToolUse(message, processed, redactor);

	// Extract usage/cost data from SDK result message
	processed.executionUsage = extractExecutionUsage(message);
}

function handleSystemMessage({ message, processed }: MessageHandlerInput): void {
	if (message.subtype === 'init') {
		processSystemInitMessage(message, processed);
	}
}

function handleArtifactMessage({
	originalMessage,
	processed,
	redactor,
}: MessageHandlerInput): void {
	processArtifactMessage(originalMessage, processed, redactor);
}

function handleUserMessage({ message, processed }: MessageHandlerInput): void {
	processUserToolDenials(message, processed);
}

function handleAssistantMessage({ message, processed, redactor }: MessageHandlerInput): void {
	processAssistantMessage(message, processed, redactor);
}

function handleResultMessage({ message, processed, redactor }: MessageHandlerInput): void {
	processResultMessage(message, processed, redactor);
}

function handleSessionFilesMessage({ message, processed }: MessageHandlerInput): void {
	const content = message.content as ManagedSessionFilesMessage['content'] | undefined;
	if (content && Array.isArray(content.files)) {
		processed.sessionFiles = content;
	}
}

const messageHandlers: Record<string, MessageHandler> = {
	system: handleSystemMessage,
	artifact: handleArtifactMessage,
	user: handleUserMessage,
	assistant: handleAssistantMessage,
	result: handleResultMessage,
	session_files: handleSessionFilesMessage,
};

function getMessageHandler(message: Record<string, unknown>): MessageHandler | undefined {
	if (typeof message.type !== 'string') {
		return undefined;
	}
	return messageHandlers[message.type];
}

/**
 * Process messages from the agent execution
 */
export function processMessages(
	messages: unknown[],
	redactor?: SecretsRedactor,
): ProcessedMessages {
	const processed = createProcessedMessages();

	for (const msg of messages) {
		if (!isRecord(msg)) {
			continue;
		}
		const message = msg;

		captureSessionIdCandidate(message, processed);

		getMessageHandler(message)?.({
			originalMessage: msg,
			message,
			processed,
			redactor,
		});
	}

	return processed;
}

function extractMarkdownErrorMessage(text: string): string | undefined {
	const errorPrefixMatch = text.match(/^\*\*Error[:*]*\*?\*?\s*(.+)/im);
	if (!errorPrefixMatch) {
		return undefined;
	}
	return errorPrefixMatch[1].trim();
}

function shortenErrorLine(line: string): string {
	if (line.length <= 200) {
		return line;
	}
	return line.substring(0, 200) + '...';
}

function extractToolErrorMessage(text: string): string | undefined {
	const errorPatterns = [
		/No such file or directory/i,
		/Permission denied/i,
		/command not found/i,
		/ENOENT/i,
		/EACCES/i,
		/EPERM/i,
		/Exit code [1-9]\d*/i,
	];

	for (const pattern of errorPatterns) {
		if (pattern.test(text)) {
			return shortenErrorLine(text.split('\n')[0]);
		}
	}

	return undefined;
}

/**
 * Detect if Claude's response indicates a tool error
 * Returns error info if detected, or null if no error found
 */
export function detectAgentError(text: string): { isError: boolean; errorMessage?: string } {
	// Pattern 1: Explicit markdown error prefix (Claude's typical error format)
	const markdownErrorMessage = extractMarkdownErrorMessage(text);
	if (markdownErrorMessage !== undefined) {
		return { isError: true, errorMessage: markdownErrorMessage };
	}

	// Pattern 2: Common tool error patterns
	const toolErrorMessage = extractToolErrorMessage(text);
	if (toolErrorMessage !== undefined) {
		return { isError: true, errorMessage: toolErrorMessage };
	}

	return { isError: false };
}
