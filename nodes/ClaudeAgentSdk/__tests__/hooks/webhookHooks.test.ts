import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildHookHandlers, type HookHandlerConfig } from '../../hooks/webhookHooks';

const BASE_CONFIG: HookHandlerConfig = {
	event: 'PreToolUse',
	handlerType: 'webhook',
	mode: 'sync',
	webhookUrl: 'https://hooks.example.test/claude',
	timeoutSeconds: 5,
	failBehaviour: 'block',
};

const HOOK_INPUT = {
	session_id: 'session_1',
	transcript_path: '/tmp/transcript.jsonl',
	cwd: '/workspace/project',
	prompt_id: 'prompt_123',
	hook_event_name: 'PreToolUse',
	tool_name: 'Bash',
	tool_input: { command: 'pwd' },
	tool_use_id: 'toolu_input_1',
} as never;

async function runHook(config: HookHandlerConfig) {
	const hooks = buildHookHandlers([config]);
	const callback = hooks.PreToolUse?.[0]?.hooks[0];
	if (!callback) {
		throw new Error('expected PreToolUse hook');
	}
	return callback(HOOK_INPUT, 'toolu_1', { signal: new AbortController().signal });
}

function nodeCommand(script: string): string {
	return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

describe('buildHookHandlers webhook/command output validation', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('blocks sync webhook HTTP 500 responses when failBehaviour is block', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })));

		await expect(runHook(BASE_CONFIG)).resolves.toEqual({
			continue: false,
			reason: 'Webhook hook handler returned HTTP 500',
		});
	});

	it('continues on invalid webhook JSON when failBehaviour is continue', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })));

		await expect(runHook({
			...BASE_CONFIG,
			failBehaviour: 'continue',
		})).resolves.toEqual({ continue: true });
	});

	it('forwards SDK prompt_id in webhook payloads', async () => {
		const fetchMock = vi.fn(async () => new Response(
			JSON.stringify({ continue: true }),
			{ status: 200 },
		));
		vi.stubGlobal('fetch', fetchMock);

		await expect(runHook(BASE_CONFIG)).resolves.toEqual({ continue: true });

		const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		const payload = JSON.parse(String(request?.body)) as Record<string, unknown>;
		expect(payload.prompt_id).toBe('prompt_123');
		expect(payload.tool_use_id).toBe('toolu_1');
	});

	it('blocks wrong-shape webhook JSON according to failBehaviour', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(
			JSON.stringify({ unexpected: 'value' }),
			{ status: 200 },
		)));

		await expect(runHook(BASE_CONFIG)).resolves.toEqual({
			continue: false,
			reason: 'Hook handler response did not contain any supported SDK output fields',
		});
	});

	it('applies failBehaviour to malformed command JSON stdout', async () => {
		await expect(runHook({
			...BASE_CONFIG,
			handlerType: 'command',
			command: nodeCommand("process.stdout.write('not-json')"),
		})).resolves.toEqual({
			continue: false,
			reason: 'Hook handler returned invalid JSON',
		});
	});
});
