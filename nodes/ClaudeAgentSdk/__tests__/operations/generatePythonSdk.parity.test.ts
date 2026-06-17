/**
 * Python SDK export parity tests — settings the Python SDK cannot express
 * must be omitted (not emitted as invalid kwargs) and surfaced as docstring
 * notes; runtime-only semantics (fast-mode beta, skills filter) must match
 * queryOptionsBuilder/querySetupContext behavior.
 *
 * Validated against claude-agent-sdk 0.2.99 (PyPI): ClaudeAgentOptions is a
 * dataclass and rejects unknown kwargs with TypeError.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IExecuteFunctions } from 'n8n-workflow';

import { generatePythonSdkScript } from '../../operations/generatePythonSdk';

interface MockExecuteFunctionsShape {
	getNodeParameter: (name: string, index: number, defaultValue?: unknown) => unknown;
	getNode: () => { parameters: Record<string, unknown> };
}

function createMockContext(params: Record<string, unknown>): IExecuteFunctions {
	const mock: MockExecuteFunctionsShape = {
		getNodeParameter: vi.fn((name: string, _index: number, defaultValue?: unknown) => {
			if (name in params) return params[name];
			return defaultValue;
		}),
		getNode: vi.fn(() => ({ parameters: params })),
	};
	return mock as unknown as IExecuteFunctions;
}

const baseParams = {
	taskDescription: 'Test task',
	workingDirectory: '',
	model: '',
	permissionMode: 'default',
	allowedTools: [],
	disallowedTools: [],
	enableStreaming: false,
	enableMcpServers: false,
	enableSubagents: false,
	structuredOutput: false,
	additionalOptions: {},
	executionSettings: {},
};

describe('generatePythonSdkScript parity', () => {
	it('omits TypeScript-SDK-only options and surfaces them as docstring notes', () => {
		const ctx = createMockContext({
			...baseParams,
			chatSessionId: 'chat-123',
			additionalOptions: {
				persistSession: false,
				promptSuggestions: true,
				correlationId: 'corr-abc',
				sessionTitle: 'My Session',
			},
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		expect(script).toContain('session_id="chat-123"');
		// Python ClaudeAgentOptions (0.2.x) rejects these kwargs with TypeError —
		// they must never be emitted as options.
		expect(script).not.toContain('persist_session=');
		expect(script).not.toContain('prompt_suggestions=');
		expect(script).not.toContain('correlation_id=');
		expect(script).not.toContain('title=');
		// Surfaced as docstring notes instead.
		expect(script).toContain('Notes:');
		expect(script).toContain('Persist Session=off is TypeScript-SDK-only');
		expect(script).toContain('Prompt Suggestions is TypeScript-SDK-only');
		expect(script).toContain('Correlation ID ("corr-abc") is TypeScript-SDK-only');
		expect(script).toContain('Session Title ("My Session") is TypeScript-SDK-only');
		expect(script).toContain('session_id is pinned from the n8n parameter');
	});

	it('emits the fast-mode beta and skills filter matching runtime semantics', () => {
		const ctx = createMockContext({
			...baseParams,
			model: 'claude-opus-4-8',
			fastMode: true,
			additionalOptions: {
				betas: ['context-1m-2025-08-07'],
				skillsFilter: 'pdf, docx',
			},
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		expect(script).toContain('betas=["context-1m-2025-08-07", "fast-mode-2026-02-01"]');
		expect(script).toContain('skills=["pdf", "docx"]');
	});

	it('does not emit the fast-mode beta for unsupported models', () => {
		const ctx = createMockContext({
			...baseParams,
			model: 'claude-sonnet-4-6',
			fastMode: true,
			additionalOptions: { skillsFilter: 'all' },
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		expect(script).not.toContain('fast-mode');
		expect(script).toContain('skills="all"');
	});

	it('renders output_format JSON Schema as Python literals, not JSON', () => {
		const ctx = createMockContext({
			...baseParams,
			structuredOutput: true,
			schemaType: 'fromJson',
			outputJsonSchema:
				'{"type":"object","properties":{"ok":{"type":"boolean"}},"additionalProperties":false}',
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		// JSON true/false/null are NameErrors in Python.
		expect(script).not.toMatch(/:\s*false/);
		expect(script).not.toMatch(/:\s*true/);
		expect(script).not.toMatch(/:\s*null/);
		expect(script).toContain('"additionalProperties": False');
	});

	it('joins user prompt context with real newlines, not literal backslash-n', () => {
		const ctx = createMockContext({
			...baseParams,
			taskDescription: 'Say hello',
			additionalOptions: { userPromptContext: 'Answer in French.' },
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		// Single-escaped \n inside the Python string literal — a double-escaped
		// \\n would inject literal backslash-n text into the prompt at runtime.
		expect(script).toContain('default="Answer in French.\\n\\nSay hello"');
		expect(script).not.toContain('\\\\n');
	});

	it('falls back to legacy max_thinking_tokens when enabled budget is zero', () => {
		const ctx = createMockContext({
			...baseParams,
			model: 'claude-sonnet-4-6',
			thinkingMode: 'enabled',
			thinkingBudgetTokens: 0,
			additionalOptions: { maxThinkingTokens: 5000 },
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		// Mirrors runtime buildStandardThinkingSetup: enabled requires budget > 0.
		expect(script).not.toContain('ThinkingConfigEnabled');
		expect(script).toContain('max_thinking_tokens=5000');
	});
});
