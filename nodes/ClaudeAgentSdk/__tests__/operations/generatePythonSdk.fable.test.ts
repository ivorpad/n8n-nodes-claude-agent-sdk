import { describe, it, expect } from 'vitest';

import { generatePythonSdkScript } from '../../operations/generatePythonSdk';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

function createContext(overrides: Record<string, unknown>) {
	return createMockExecuteFunctions({
		taskDescription: 'Do the task',
		workingDirectory: '',
		permissionMode: 'default',
		allowedTools: [],
		disallowedTools: [],
		enableStreaming: false,
		enableMcpServers: false,
		enableSubagents: false,
		structuredOutput: false,
		additionalOptions: {},
		executionSettings: {},
		...overrides,
	});
}

describe('generatePythonSdkScript — Fable 5 thinking', () => {
	it('defaults Sonnet 5 to adaptive thinking and supports xhigh effort', () => {
		const ctx = createContext({
			model: 'claude-sonnet-5',
			effort: 'xhigh',
			additionalOptions: { maxThinkingTokens: 32000 },
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		expect(script).toContain('model="claude-sonnet-5"');
		expect(script).toContain('ThinkingConfigAdaptive(type="adaptive")');
		expect(script).toContain('effort="xhigh"');
		expect(script).not.toContain('max_thinking_tokens');
	});

	it('defaults Fable 5 to adaptive thinking', () => {
		const ctx = createContext({ model: 'claude-fable-5' });

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		expect(script).toContain('model="claude-fable-5"');
		expect(script).toContain('ThinkingConfigAdaptive(type="adaptive")');
	});

	// Fable 5 returns HTTP 400 for an explicit thinking disable — the generated
	// script must omit the thinking parameter entirely, or it fails at runtime.
	it('omits the thinking option for Fable 5 when thinking is disabled', () => {
		const ctx = createContext({
			model: 'claude-fable-5',
			thinkingMode: 'disabled',
			effort: 'high',
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		expect(script).toContain('model="claude-fable-5"');
		expect(script).not.toContain('ThinkingConfigDisabled');
		expect(script).not.toContain('thinking=');
		expect(script).toContain('effort="high"');
	});

	// Legacy maxThinkingTokens must not leak through as max_thinking_tokens on
	// adaptive-only models when the thinking option is omitted (Fable disable).
	it('does not emit max_thinking_tokens for Fable 5 with thinking disabled', () => {
		const ctx = createContext({
			model: 'claude-fable-5',
			thinkingMode: 'disabled',
			additionalOptions: { maxThinkingTokens: 32000 },
		});

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		expect(script).not.toContain('max_thinking_tokens');
		expect(script).not.toContain('thinking=');
	});

	it('keeps the explicit thinking disable for Opus 4.8 (still accepted there)', () => {
		const ctx = createContext({ model: 'claude-opus-4-8', thinkingMode: 'disabled' });

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		expect(script).toContain('ThinkingConfigDisabled(type="disabled")');
	});

	it('resolves the fable alias like the pinned id', () => {
		const ctx = createContext({ model: 'fable', thinkingMode: 'disabled' });

		const script = generatePythonSdkScript(ctx, 0).json.script as string;

		expect(script).toContain('model="fable"');
		expect(script).not.toContain('thinking=');
	});
});
