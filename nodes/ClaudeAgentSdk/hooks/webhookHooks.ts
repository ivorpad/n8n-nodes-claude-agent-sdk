/**
 * Hook Handlers — Webhook + Command
 *
 * Builds SDK-compatible hook callbacks that either:
 * - POST events to an external webhook (sync or fire-and-forget)
 * - Run a local shell command with the event JSON on stdin
 */

import type {
	HookCallback,
	HookCallbackMatcher,
	HookEvent,
	HookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'child_process';

import { buildHookCommandEnv } from './hookEnv';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface HookHandlerConfig {
	event: HookEvent;
	handlerType: 'webhook' | 'command';
	mode: 'sync' | 'fireAndForget';
	webhookUrl?: string;
	command?: string;
	matcher?: string;
	timeoutSeconds: number;
	failBehaviour: 'continue' | 'block';
}

const SYNC_HOOK_OUTPUT_KEYS = new Set([
	'continue',
	'suppressOutput',
	'stopReason',
	'decision',
	'systemMessage',
	'terminalSequence',
	'reason',
	'hookSpecificOutput',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failHookHandler(config: HookHandlerConfig, reason: string): HookJSONOutput {
	return config.failBehaviour === 'block'
		? { continue: false, reason }
		: { continue: true };
}

function validateStringField(
	output: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = output[key];
	if (value === undefined || typeof value === 'string') {
		return undefined;
	}
	return `"${key}" must be a string`;
}

function validateBooleanField(
	output: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = output[key];
	if (value === undefined || typeof value === 'boolean') {
		return undefined;
	}
	return `"${key}" must be a boolean`;
}

function validateHookSpecificOutput(output: Record<string, unknown>): string | undefined {
	if (output.hookSpecificOutput === undefined) {
		return undefined;
	}
	if (!isRecord(output.hookSpecificOutput)) {
		return '"hookSpecificOutput" must be an object';
	}
	if (typeof output.hookSpecificOutput.hookEventName !== 'string') {
		return '"hookSpecificOutput.hookEventName" must be a string';
	}
	return undefined;
}

function validateHookOutput(value: unknown): { ok: true; output: HookJSONOutput } | { ok: false; reason: string } {
	if (!isRecord(value)) {
		return { ok: false, reason: 'Hook handler response must be a JSON object' };
	}

	if (Object.prototype.hasOwnProperty.call(value, 'async')) {
		if (value.async !== true) {
			return { ok: false, reason: '"async" must be true when present' };
		}
		const asyncTimeout = value.asyncTimeout;
		if (asyncTimeout !== undefined && (typeof asyncTimeout !== 'number' || !Number.isFinite(asyncTimeout))) {
			return { ok: false, reason: '"asyncTimeout" must be a finite number' };
		}
		return { ok: true, output: value as HookJSONOutput };
	}

	for (const key of ['continue', 'suppressOutput']) {
		const error = validateBooleanField(value, key);
		if (error) return { ok: false, reason: error };
	}
	for (const key of ['stopReason', 'systemMessage', 'terminalSequence', 'reason']) {
		const error = validateStringField(value, key);
		if (error) return { ok: false, reason: error };
	}
	if (value.decision !== undefined && value.decision !== 'approve' && value.decision !== 'block') {
		return { ok: false, reason: '"decision" must be "approve" or "block"' };
	}
	const hookSpecificError = validateHookSpecificOutput(value);
	if (hookSpecificError) {
		return { ok: false, reason: hookSpecificError };
	}

	const keys = Object.keys(value);
	const hasKnownKey = keys.some((key) => SYNC_HOOK_OUTPUT_KEYS.has(key));
	if (keys.length > 0 && !hasKnownKey) {
		return { ok: false, reason: 'Hook handler response did not contain any supported SDK output fields' };
	}

	return { ok: true, output: value as HookJSONOutput };
}

function parseHookOutput(raw: string): { ok: true; output: HookJSONOutput } | { ok: false; reason: string } {
	try {
		return validateHookOutput(JSON.parse(raw));
	} catch {
		return { ok: false, reason: 'Hook handler returned invalid JSON' };
	}
}

// ---------------------------------------------------------------------------
// Webhook callback
// ---------------------------------------------------------------------------

function buildWebhookCallback(config: HookHandlerConfig): HookCallback {
	const url = config.webhookUrl!;

	return async (input, toolUseId, { signal }) => {
		const payload = { ...input, tool_use_id: toolUseId };

		if (config.mode === 'fireAndForget') {
			fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(5000),
			}).catch(() => {});
			return { continue: true };
		}

		try {
			const timeoutSignal = AbortSignal.timeout(config.timeoutSeconds * 1000);
			const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

			const response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: combinedSignal,
			});
			if (!response.ok) {
				return failHookHandler(
					config,
					`Webhook hook handler returned HTTP ${response.status}`,
				);
			}

			const rawBody = await response.text();
			const parsed = parseHookOutput(rawBody);
			if (!parsed.ok) {
				return failHookHandler(config, parsed.reason);
			}
			return parsed.output;
		} catch {
			return failHookHandler(config, 'Webhook hook handler timed out or errored');
		}
	};
}

// ---------------------------------------------------------------------------
// Command callback
// ---------------------------------------------------------------------------

function runCommand(
	cmd: string,
	stdinData: string,
	timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve) => {
		// SECURITY: pass an allowlisted env (see hookEnv.ts). The default would
		// inherit all of n8n's secrets (encryption key, DB password, API keys).
		const child = spawn(cmd, { shell: true, timeout: timeoutMs, env: buildHookCommandEnv(process.env) });
		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
		child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

		child.on('close', (code) => {
			resolve({ stdout, stderr, exitCode: code ?? 1 });
		});
		child.on('error', (err) => {
			resolve({ stdout, stderr: err.message, exitCode: 1 });
		});

		child.stdin.write(stdinData);
		child.stdin.end();
	});
}

function buildCommandCallback(config: HookHandlerConfig): HookCallback {
	const cmd = config.command!;

	return async (input, toolUseId) => {
		const payload = JSON.stringify({ ...input, tool_use_id: toolUseId });

		if (config.mode === 'fireAndForget') {
			// Spawn and don't wait — swallow errors
			try {
				// SECURITY: same env containment as the sync path — the
				// fire-and-forget spawn must not inherit n8n's secrets either.
				const child = spawn(cmd, { shell: true, stdio: 'pipe', env: buildHookCommandEnv(process.env) });
				child.stdin.write(payload);
				child.stdin.end();
				child.on('error', () => {});
			} catch { /* swallow */ }
			return { continue: true };
		}

		// Sync — run command, parse stdout as JSON response
		try {
			const { stdout, exitCode } = await runCommand(
				cmd,
				payload,
				config.timeoutSeconds * 1000,
			);

			// Non-zero exit = block (convention matching Claude Code hooks)
			if (exitCode !== 0) {
				const reason = stdout.trim() || `Command exited with code ${exitCode}`;
				return { continue: false, reason };
			}

			// Try to parse stdout as JSON hook response
			const trimmed = stdout.trim();
			if (trimmed) {
				const parsed = parseHookOutput(trimmed);
				if (!parsed.ok) {
					return failHookHandler(config, parsed.reason);
				}
				return parsed.output;
			}

			return { continue: true };
		} catch {
			return failHookHandler(config, 'Command hook handler timed out or errored');
		}
	};
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

function buildCallback(config: HookHandlerConfig): HookCallback {
	return config.handlerType === 'command'
		? buildCommandCallback(config)
		: buildWebhookCallback(config);
}

/**
 * Build SDK hooks from user-configured hook handlers.
 * Returns a partial hooks record that can be merged with other hook sources.
 */
export function buildHookHandlers(
	configs: HookHandlerConfig[],
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
	const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

	for (const config of configs) {
		const matcher: HookCallbackMatcher = {
			...(config.matcher && { matcher: config.matcher }),
			hooks: [buildCallback(config)],
			timeout: config.timeoutSeconds,
		};

		const existing = hooks[config.event];
		if (existing) {
			existing.push(matcher);
		} else {
			hooks[config.event] = [matcher];
		}
	}

	return hooks;
}
