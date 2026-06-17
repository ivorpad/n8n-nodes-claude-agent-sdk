import { describe, expect, it } from 'vitest';

import { processMessages } from '../../operations/executeTask/messages';
import { createSecretsRedactor } from '../../operations/executeTask/secretsRedaction';

describe('processMessages', () => {
	it('collects user-visible outputs and prefers system init session metadata', () => {
		const redactor = createSecretsRedactor(['api-secret']);
		const messages: unknown[] = [
			{
				type: 'system',
				subtype: 'hook_response',
				session_id: 'hook-session',
			},
			{
				type: 'assistant',
				message: {
					content: [
						{ type: 'text', text: 'assistant text api-secret' },
						{ type: 'tool_use', name: 'Read', input: { path: '/tmp/api-secret' } },
						{ type: 'tool_use', name: ' ', input: { ignored: true } },
						{ type: 'thinking', text: 'hidden chain of thought' },
					],
				},
			},
			{
				type: 'artifact',
				name: 'report',
				payload: { value: 'api-secret' },
			},
			{
				type: 'assistant',
				message: {
					content: [
						{ type: 'tool_use', name: 'Bash', input: { command: 'echo api-secret' } },
					],
				},
			},
			{
				// Canonical denial shape: tool_result block (is_error) inside a
				// user message — no top-level 'tool_result' message type exists.
				type: 'user',
				message: {
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'toolu_edit_1',
							is_error: true,
							content: [
								{ type: 'text', text: 'permission denied' },
								{ type: 'image', source: 'ignored' },
								{ type: 'text', text: 'api-secret blocked' },
							],
						},
					],
				},
			},
			{
				type: 'session_files',
				session_id: 'sesn_x',
				content: {
					files: [
						{ fileId: 'file_1', filename: 'out.txt', mimeType: 'text/plain', sizeBytes: 5, createdAt: '2026-06-11T00:00:00Z' },
					],
				},
			},
			{
				type: 'system',
				subtype: 'init',
				session_id: 'init-session',
				mcp_servers: [{ name: 'filesystem', status: 'connected' }],
			},
		];

		const processed = processMessages(messages, redactor);

		expect(processed.sessionId).toBe('init-session');
		expect(processed.mcpServerStatus).toEqual([{ name: 'filesystem', status: 'connected' }]);
		expect(processed.textMessages).toEqual(['assistant text [REDACTED]']);
		expect(processed.artifacts).toEqual([
			{
				type: 'artifact',
				name: 'report',
				payload: { value: '[REDACTED]' },
			},
		]);
		expect(processed.toolCalls).toEqual([
			{ tool: 'Read', input: { path: '/tmp/[REDACTED]' } },
			{ tool: 'Bash', input: { command: 'echo [REDACTED]' } },
		]);
		expect(processed.toolDenials).toEqual([
			{ tool: 'toolu_edit_1', reason: 'permission denied\napi-secret blocked' },
		]);
		expect(processed.sessionFiles).toEqual({
			files: [
				{ fileId: 'file_1', filename: 'out.txt', mimeType: 'text/plain', sizeBytes: 5, createdAt: '2026-06-11T00:00:00Z' },
			],
		});
	});

	it('preserves raw structured output while redacting returned result payloads', () => {
		const redactor = createSecretsRedactor(['api-secret']);
		const deferredToolUse = {
			id: 'toolu_123',
			name: 'Write',
			input: { content: 'api-secret' },
		};
		const structuredOutput = {
			status: 'ok',
			secret: 'api-secret',
		};
		const messages: unknown[] = [
			{
				type: 'result',
				subtype: 'success',
				structured_output: structuredOutput,
				terminal_reason: 'tool_deferred',
				deferred_tool_use: deferredToolUse,
				total_cost_usd: 1.25,
				num_turns: 3,
				duration_ms: 4000,
				duration_api_ms: 2500,
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 20,
					cache_creation_input_tokens: 10,
				},
				modelUsage: {
					'claude-sonnet-4-5': {
						inputTokens: 100,
						outputTokens: 50,
						cacheReadInputTokens: 20,
						cacheCreationInputTokens: 10,
						webSearchRequests: 2,
						costUSD: 1.25,
						contextWindow: 200000,
						maxOutputTokens: 64000,
					},
				},
			},
		];

		const processed = processMessages(messages, redactor);

		expect(processed.resultSubtype).toBe('success');
		expect(processed.rawStructuredOutputResult).toBe(structuredOutput);
		expect(processed.structuredOutputResult).toEqual({
			status: 'ok',
			secret: '[REDACTED]',
		});
		expect(processed.terminalReason).toBe('tool_deferred');
		expect(processed.deferredToolUse).toEqual({
			id: 'toolu_123',
			name: 'Write',
			input: { content: '[REDACTED]' },
		});
		expect(processed.executionUsage).toEqual({
			totalCostUsd: 1.25,
			numTurns: 3,
			durationMs: 4000,
			durationApiMs: 2500,
			usage: {
				inputTokens: 100,
				outputTokens: 50,
				cacheReadInputTokens: 20,
				cacheCreationInputTokens: 10,
			},
			modelUsage: {
				'claude-sonnet-4-5': {
					inputTokens: 100,
					outputTokens: 50,
					cacheReadInputTokens: 20,
					cacheCreationInputTokens: 10,
					webSearchRequests: 2,
					costUSD: 1.25,
					contextWindow: 200000,
					maxOutputTokens: 64000,
				},
			},
		});
	});

	it('uses fallback values for tool denials and result usage fields', () => {
		const processed = processMessages([
			{
				type: 'user',
				message: {
					role: 'user',
					content: [
						{ type: 'tool_result', is_error: true, content: { code: 'blocked' } },
					],
				},
			},
			{
				type: 'result',
				subtype: 'error_during_execution',
			},
		]);

		expect(processed.toolDenials).toEqual([{ tool: 'unknown', reason: '{"code":"blocked"}' }]);
		expect(processed.executionUsage).toEqual({
			totalCostUsd: 0,
			numTurns: 0,
			durationMs: 0,
			durationApiMs: 0,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadInputTokens: 0,
				cacheCreationInputTokens: 0,
			},
			modelUsage: {},
		});
	});

	it('records warnings when present SDK usage numbers are malformed', () => {
		const processed = processMessages([
			{
				type: 'result',
				subtype: 'success',
				total_cost_usd: 'not-a-number',
				num_turns: Number.NaN,
				duration_ms: Infinity,
				duration_api_ms: 250,
				usage: {
					input_tokens: '100',
					output_tokens: null,
					cache_read_input_tokens: 20,
					cache_creation_input_tokens: 10,
				},
				modelUsage: {
					'claude-sonnet-4-5': {
						inputTokens: '100',
						outputTokens: 50,
						cacheReadInputTokens: Number.NaN,
						cacheCreationInputTokens: 10,
						webSearchRequests: '2',
						costUSD: null,
						contextWindow: 200000,
						maxOutputTokens: 64000,
					},
				},
			},
		]);

		expect(processed.executionUsage).toMatchObject({
			totalCostUsd: 0,
			numTurns: 0,
			durationMs: 0,
			durationApiMs: 250,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadInputTokens: 20,
				cacheCreationInputTokens: 10,
			},
			modelUsage: {
				'claude-sonnet-4-5': {
					inputTokens: 0,
					outputTokens: 50,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 10,
					webSearchRequests: 0,
					costUSD: 0,
					contextWindow: 200000,
					maxOutputTokens: 64000,
				},
			},
		});
		expect(processed.executionUsage?.warnings).toEqual(expect.arrayContaining([
			expect.stringContaining('total_cost_usd'),
			expect.stringContaining('num_turns'),
			expect.stringContaining('duration_ms'),
			expect.stringContaining('usage.input_tokens'),
			expect.stringContaining('usage.output_tokens'),
			expect.stringContaining('modelUsage.claude-sonnet-4-5.inputTokens'),
			expect.stringContaining('modelUsage.claude-sonnet-4-5.cacheReadInputTokens'),
			expect.stringContaining('modelUsage.claude-sonnet-4-5.webSearchRequests'),
			expect.stringContaining('modelUsage.claude-sonnet-4-5.costUSD'),
		]));
	});

	it('preserves SDK-added model usage fields while validating canonical numbers', () => {
		const processed = processMessages([
			{
				type: 'result',
				subtype: 'success',
				modelUsage: {
					'claude-future-model': {
						inputTokens: 1,
						outputTokens: 2,
						cacheReadInputTokens: 3,
						cacheCreationInputTokens: 4,
						webSearchRequests: 5,
						costUSD: 0.25,
						contextWindow: 200000,
						maxOutputTokens: 64000,
						cacheWriteInputTokens: 7,
						providerMetadata: { region: 'us' },
					},
				},
			},
		]);

		expect(processed.executionUsage?.warnings).toBeUndefined();
		expect(processed.executionUsage?.modelUsage['claude-future-model']).toEqual({
			inputTokens: 1,
			outputTokens: 2,
			cacheReadInputTokens: 3,
			cacheCreationInputTokens: 4,
			webSearchRequests: 5,
			costUSD: 0.25,
			contextWindow: 200000,
			maxOutputTokens: 64000,
			cacheWriteInputTokens: 7,
			providerMetadata: { region: 'us' },
		});
	});

	it('captures structured refusal stop details without relying on response text', () => {
		const stopDetails = {
			type: 'refusal',
			reason: 'safety',
		};

		const processed = processMessages([
			{
				type: 'assistant',
				stop_reason: 'refusal',
				stop_details: stopDetails,
				message: {
					content: [
						{ type: 'text', text: '**Error:** legacy-looking text should not be the only signal' },
					],
				},
			},
		]);

		expect(processed.stopReason).toBe('refusal');
		expect(processed.stopDetails).toBe(stopDetails);
		expect(processed.textMessages).toEqual([
			'**Error:** legacy-looking text should not be the only signal',
		]);
	});
});
