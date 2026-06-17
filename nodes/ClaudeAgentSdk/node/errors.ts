/**
 * Node error formatting helpers.
 *
 * These helpers are used by `ClaudeAgentSdk.node.ts` to produce user-friendly
 * error messages for common runtime issues (Docker paths, Ollama config, etc).
 */

import {
	isOllamaVersionError,
	isUsagePolicyViolation,
	detectToolsNotSupported,
	buildToolsNotSupportedMessage,
	buildUsagePolicyMessage,
} from '../errorClassification';

type ExecutionContext = { provider?: string; model?: string };

// Track current execution context for better error messages.
let currentExecutionContext: ExecutionContext = {};

export function setExecutionContext(context: ExecutionContext): void {
	currentExecutionContext = context;
}

/**
 * Extract a meaningful error message from any error type.
 */
export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		// Handle specific error codes
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === 'ENOENT') {
			const path = nodeError.path || (error as { syscall?: string }).syscall;
			return `File or directory not found: ${path || 'unknown path'}. Check that the working directory exists inside the container.`;
		}
		if (nodeError.code === 'EACCES') {
			return `Permission denied: ${nodeError.path || 'unknown path'}`;
		}
		if (nodeError.code === 'ECONNREFUSED') {
			const host = (error.message?.match(/(\w+:\/\/[\w.-]+:\d+)/) || [])[1];
			if (host?.includes('localhost:11434') || host?.includes('127.0.0.1:11434')) {
				return `Connection refused to Ollama at ${host}. Make sure Ollama is running ("ollama serve"). If in Docker, use host.docker.internal:11434 instead of localhost:11434.`;
			}
			return 'Connection refused. Check that the service is running and accessible.';
		}

		// Check for Ollama version compatibility errors
		if (isOllamaVersionError(error.message)) {
			return 'Ollama v0.14.0+ is required for Anthropic Messages API compatibility. Upgrade Ollama and retry.';
		}

		// Check for "does not support tools" error (common with Ollama models)
		const toolsModelName = detectToolsNotSupported(error);
		if (toolsModelName) {
			return buildToolsNotSupportedMessage(toolsModelName, '\\n');
		}

		// Check for EPERM on uv_cwd (macOS TCC / deleted working directory)
		if (error.message?.includes('EPERM') && error.message?.includes('uv_cwd')) {
			return (
				'Claude Code process cannot access its working directory (EPERM on uv_cwd).\n\n' +
				'This typically means:\n' +
				'  1. The Working Directory is inside a macOS-protected folder (Downloads, Desktop, Documents)\n' +
				'     → Grant Full Disk Access to your terminal, or use a directory outside protected locations\n' +
				'  2. The working directory was deleted after validation but before the process started\n\n' +
				'To fix: change Working Directory to a non-protected path (e.g., ~/projects/my-agent).'
			);
		}

		// Check for Claude SDK specific errors
		if (error.message?.includes('spawn') && error.message?.includes('ENOENT')) {
			return (
				'Failed to spawn Claude CLI. Ensure Claude Code is installed and accessible.\\n\\n' +
				'Set the executable path in the Claude API credential, or ensure the `claude` binary is on PATH.'
			);
		}

		// Check for Anthropic usage policy violation
		if (error.message && isUsagePolicyViolation(error.message)) {
			// If it's already our formatted message, return as-is
			if (error.message.startsWith('Content policy rejection:')) {
				return error.message;
			}
			return buildUsagePolicyMessage('\\n');
		}

		// Check for exit code errors
		// If stderr output is included (from our enhanced error), show the full message
		if (error.message?.includes('exited with code')) {
			if (error.message?.includes('Claude CLI stderr output:')) {
				// Already has detailed stderr - return as-is
				return error.message;
			}

			// For Ollama provider with exit code 1, provide specific guidance
			if (currentExecutionContext.provider === 'ollama') {
				const model = currentExecutionContext.model || 'the selected model';
				return (
					'Claude Code process failed with Ollama.\\n\\n' +
					`Current model: ${model}\\n\\n` +
					'Common causes:\\n' +
					`  1. Model not pulled - run: ollama pull ${model}\\n` +
					'  2. Model does not support tools (Claude Code requires tool support)\\n' +
					'  3. Ollama not running - run: ollama serve\\n\\n' +
					'Recommended Ollama models with tool support:\\n' +
					'  • Local: qwen3-coder, gpt-oss:20b\\n' +
					'  • Cloud: glm-4.7:cloud, minimax-m2.1:cloud\\n\\n' +
					'To use a compatible model:\\n' +
					'  ollama pull qwen3-coder'
				);
			}

			// For Alibaba Coding Plan provider, provide specific guidance
			if (currentExecutionContext.provider === 'alibaba') {
				return (
					'Claude Code process failed with Alibaba Coding Plan.\\n\\n' +
					'Common causes:\\n' +
					'  1. Invalid API key — verify your Alibaba Coding Plan API key\\n' +
					'  2. No model selected — select at least a Sonnet Model tier\\n' +
					'  3. Model not available on your plan tier (Lite+Pro vs Pro only)\\n' +
					'  4. hasCompletedOnboarding not set — ensure ~/.claude.json contains {"hasCompletedOnboarding": true}\\n' +
					'  5. Thinking budget rejected — disable thinking or keep budget within provider limits (for glm-5: 1-38912)\\n\\n' +
					'Verify your credentials/model selection and inspect ~/.claude/debug/<session>.txt for the exact provider error.'
				);
			}

			return `Claude process failed: ${error.message}. Check Claude CLI authentication and configuration.`;
		}

		return error.message || 'Unknown error occurred';
	}

	if (typeof error === 'string') {
		return error;
	}

	if (error && typeof error === 'object') {
		const errObj = error as Record<string, unknown>;
		if (errObj.message) return String(errObj.message);
		if (errObj.error) return String(errObj.error);
		if (errObj.reason) return String(errObj.reason);
	}

	return 'Unknown error occurred';
}

/**
 * Get detailed error information for debugging.
 */
export function getErrorDetails(error: unknown): Record<string, unknown> {
	const details: Record<string, unknown> = {};

	if (error instanceof Error) {
		details.name = error.name;
		details.message = error.message;
		details.stack = error.stack;

		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code) details.code = nodeError.code;
		if (nodeError.path) details.path = nodeError.path;
		if (nodeError.syscall) details.syscall = nodeError.syscall;
	} else if (typeof error === 'object' && error !== null) {
		Object.assign(details, error);
	} else {
		details.raw = String(error);
	}

	return details;
}

/**
 * Get a description to help users fix the error.
 */
export function getErrorDescription(error: unknown): string | undefined {
	if (error instanceof Error) {
		const nodeError = error as NodeJS.ErrnoException;

		if (nodeError.code === 'ENOENT') {
			return 'This usually means a file path doesn\'t exist. If using Docker, ensure you\'re using container paths (e.g., /projects/myapp) not host paths.';
		}

		if (nodeError.code === 'ECONNREFUSED') {
			const host = (error.message?.match(/(\w+:\/\/[\w.-]+:\d+)/) || [])[1];
			if (host?.includes('localhost:11434') || host?.includes('127.0.0.1:11434')) {
				return 'Start Ollama with "ollama serve" and ensure it\'s accessible. In Docker environments, configure the Ollama Base URL to use host.docker.internal:11434.';
			}
			return 'Verify the API endpoint is accessible and the service is running.';
		}

		if (isOllamaVersionError(error.message)) {
			return 'Update Ollama to v0.14.0 or newer (run `ollama --version` to confirm). The Anthropic Messages API compatibility landed in v0.14.0+.';
		}

		if (error.message?.includes('EPERM') && error.message?.includes('uv_cwd')) {
			return 'The spawned Claude Code process cannot resolve its working directory. On macOS, protected folders (Downloads, Desktop, Documents) require Full Disk Access. Use a directory outside these locations.';
		}

		if (error.message?.includes('spawn') && error.message?.includes('ENOENT')) {
			return 'The Claude CLI binary was not found. Make sure it\'s installed in your container and set the executable path in the Claude API credential.';
		}

		// Check for authentication errors
		if (error.message?.includes('401') || error.message?.toLowerCase().includes('unauthorized')) {
			if (error.message?.includes('openrouter')) {
				return 'OpenRouter authentication failed. Verify your OpenRouter API key and ensure the Anthropic API key credential is empty.';
			}
			return 'Authentication failed. Verify your API key is correct or run "claude login" for Anthropic.';
		}

		// Check for API endpoint errors
		if (error.message?.includes('404') && error.message?.toLowerCase().includes('not found')) {
			return 'API endpoint not found. Verify the custom endpoint URL is correct and implements the Anthropic Messages API.';
		}

		if (error.message && isUsagePolicyViolation(error.message)) {
			return 'This is an API-side content filter, not a code bug. The claude_code preset includes tool descriptions (Bash, file access) that can trigger false positives when combined with certain prompts. Try a simpler task description.';
		}

		if (error.message?.includes('exited with code 1')) {
			// Don't show generic hint if we already have detailed stderr
			if (error.message?.includes('Claude CLI stderr output:')) {
				return undefined;
			}
			return 'Claude CLI returned an error. Common causes: not authenticated (run "claude login"), invalid configuration, or MCP server failed to start.';
		}
	}

	return undefined;
}
