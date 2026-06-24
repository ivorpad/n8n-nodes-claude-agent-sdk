import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	debugError,
	debugLog,
	debugWarn,
	isClaudeAgentSdkDebugLoggingEnabled,
} from '../diagnostics';

describe('Claude Agent SDK diagnostics', () => {
	const originalN8nDevReload = process.env.N8N_DEV_RELOAD;
	const originalDebugLogs = process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS;
	const originalNodeEnv = process.env.NODE_ENV;

	afterEach(() => {
		if (originalN8nDevReload === undefined) {
			delete process.env.N8N_DEV_RELOAD;
		} else {
			process.env.N8N_DEV_RELOAD = originalN8nDevReload;
		}

		if (originalDebugLogs === undefined) {
			delete process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS;
		} else {
			process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS = originalDebugLogs;
		}

		if (originalNodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = originalNodeEnv;
		}

		vi.restoreAllMocks();
	});

	it('does not emit console output by default', () => {
		delete process.env.N8N_DEV_RELOAD;
		delete process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS;

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		debugLog('log');
		debugWarn('warn');
		debugError('error');

		expect(isClaudeAgentSdkDebugLoggingEnabled()).toBe(false);
		expect(logSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('emits console output when n8n custom-node dev reload is enabled', () => {
		process.env.N8N_DEV_RELOAD = 'true';
		delete process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS;

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

		debugLog('dev log');

		expect(isClaudeAgentSdkDebugLoggingEnabled()).toBe(true);
		expect(logSpy).toHaveBeenCalledWith('dev log');
	});

	it('emits console output when package debug logs are enabled', () => {
		delete process.env.N8N_DEV_RELOAD;
		process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS = 'true';

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		debugWarn('debug warning');

		expect(isClaudeAgentSdkDebugLoggingEnabled()).toBe(true);
		expect(warnSpy).toHaveBeenCalledWith('debug warning');
	});

	it('does not treat NODE_ENV=development as this node dev mode', () => {
		delete process.env.N8N_DEV_RELOAD;
		delete process.env.CLAUDE_AGENT_SDK_DEBUG_LOGS;
		process.env.NODE_ENV = 'development';

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		debugError('development error');

		expect(isClaudeAgentSdkDebugLoggingEnabled()).toBe(false);
		expect(errorSpy).not.toHaveBeenCalled();
	});
});
