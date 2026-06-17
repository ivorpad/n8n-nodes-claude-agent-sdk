/**
 * Shared error classification patterns and detection utilities.
 *
 * Used by both operations/executeTask/execution.ts (runtime error catching)
 * and node/errors.ts (user-facing error formatting) to avoid duplicating
 * pattern matching and message construction logic.
 */

// ── Patterns ────────────────────────────────────────────────────────────

/** Matches errors from models that don't support tools */
const TOOL_SUPPORT_PATTERN = /does not support tools/i;

/** Extracts Ollama model name from registry path */
const OLLAMA_MODEL_PATTERN = /registry\.ollama\.ai\/library\/([^\s"]+)/;

/** Matches JSON payload in Claude CLI "API Error: NNN {…}" format */
const API_ERROR_JSON_PATTERN = /API Error:\s*\d+\s*(\{.*\})/;

/** Matches Anthropic Usage Policy violation text */
const USAGE_POLICY_PATTERN =
	/violat\w*\s+.*Usage Policy|unable to respond to this request.*Usage Policy|Usage Policy.*violat/i;

// ── Detection ───────────────────────────────────────────────────────────

/**
 * Extract Ollama model name from text, defaulting to 'the selected model'.
 */
function extractOllamaModelName(text: string): string {
	const match = text.match(OLLAMA_MODEL_PATTERN);
	return match ? match[1] : 'the selected model';
}

/**
 * Check if text indicates a usage policy violation.
 */
export function isUsagePolicyViolation(text: string): boolean {
	return USAGE_POLICY_PATTERN.test(text) || text.includes('Content policy rejection');
}

/**
 * Check for Ollama version compatibility errors.
 */
export function isOllamaVersionError(message: string | undefined): boolean {
	if (!message) return false;
	const normalized = message.toLowerCase();
	if (!normalized.includes('ollama version')) return false;
	return (
		normalized.includes('anthropic messages api compatibility') ||
		normalized.includes('requires v0.14') ||
		normalized.includes('v0.14.0+')
	);
}

/**
 * Detect "model does not support tools" errors from Ollama.
 *
 * Searches multiple error locations (message, API Error JSON, stderr,
 * cause, apiError property, and optional additional text) for the
 * tool-support pattern.
 *
 * @returns The detected model name if the error is a tool-support error, null otherwise.
 */
export function detectToolsNotSupported(
	error: unknown,
	additionalText?: string,
): string | null {
	// Check additional text (e.g. combined error message + stderr) first
	if (additionalText && TOOL_SUPPORT_PATTERN.test(additionalText)) {
		return extractOllamaModelName(additionalText);
	}

	if (!(error instanceof Error)) {
		// Check non-Error objects for apiError property
		if (error && typeof error === 'object') {
			return checkApiErrorProperty(error as Record<string, unknown>);
		}
		return null;
	}

	// Check error message directly
	if (TOOL_SUPPORT_PATTERN.test(error.message)) {
		return extractOllamaModelName(error.message);
	}

	// Try to parse API Error JSON from message (Claude CLI format)
	const apiErrorMatch = error.message.match(API_ERROR_JSON_PATTERN);
	if (apiErrorMatch) {
		try {
			const apiErrorJson = JSON.parse(apiErrorMatch[1]);
			const innerMessage = apiErrorJson?.error?.message || apiErrorJson?.message;
			if (innerMessage && TOOL_SUPPORT_PATTERN.test(innerMessage)) {
				return extractOllamaModelName(innerMessage);
			}
		} catch {
			// JSON parse failed, continue to other checks
		}
	}

	const errObj = error as unknown as Record<string, unknown>;

	// Check stderr property (from enhanced errors)
	if (typeof errObj.stderr === 'string') {
		if (TOOL_SUPPORT_PATTERN.test(errObj.stderr)) {
			return extractOllamaModelName(errObj.stderr);
		}
		// Also try to parse API Error from stderr
		const stderrApiMatch = errObj.stderr.match(API_ERROR_JSON_PATTERN);
		if (stderrApiMatch) {
			try {
				const apiErrorJson = JSON.parse(stderrApiMatch[1]);
				const innerMessage = apiErrorJson?.error?.message || apiErrorJson?.message;
				if (innerMessage && TOOL_SUPPORT_PATTERN.test(innerMessage)) {
					return extractOllamaModelName(innerMessage);
				}
			} catch {
				// JSON parse failed
			}
		}
	}

	// Check cause property (might be attached by SDK)
	if (errObj.cause && typeof errObj.cause === 'object') {
		const cause = errObj.cause as Record<string, unknown>;
		const causeMessage = cause.message as string | undefined;
		if (causeMessage && TOOL_SUPPORT_PATTERN.test(causeMessage)) {
			return extractOllamaModelName(causeMessage);
		}
	}

	// Check apiError property (might be attached by SDK)
	return checkApiErrorProperty(errObj);
}

function checkApiErrorProperty(errObj: Record<string, unknown>): string | null {
	if (errObj.apiError && typeof errObj.apiError === 'object') {
		const apiError = errObj.apiError as Record<string, unknown>;
		const innerError = apiError.error as Record<string, unknown> | undefined;
		const message = (innerError?.message || apiError.message) as string | undefined;

		if (message && TOOL_SUPPORT_PATTERN.test(message)) {
			return extractOllamaModelName(message);
		}
	}
	return null;
}

// ── Message Builders ────────────────────────────────────────────────────

/**
 * Build user-friendly message for "model does not support tools" errors.
 *
 * @param modelName - The model name to include in the message
 * @param nl - Newline sequence to use (default: real newline)
 */
export function buildToolsNotSupportedMessage(modelName: string, nl = '\n'): string {
	return (
		`Model "${modelName}" does not support tools. ` +
		`Claude Code requires tool support for file operations and bash commands.${nl}${nl}` +
		`Recommended Ollama models with tool support:${nl}` +
		`  \u2022 Local: qwen3-coder, gpt-oss:20b${nl}` +
		`  \u2022 Cloud: glm-4.7:cloud, minimax-m2.1:cloud${nl}${nl}` +
		`To use a compatible model:${nl}` +
		`  ollama pull qwen3-coder`
	);
}

/**
 * Build user-friendly message for usage policy violation errors.
 *
 * @param nl - Newline sequence to use (default: real newline)
 */
export function buildUsagePolicyMessage(nl = '\n'): string {
	return (
		`Content policy rejection: The API declined this request due to Anthropic's Usage Policy.${nl}${nl}` +
		`This can happen when the combination of the system prompt (claude_code preset with tool descriptions) ` +
		`and user prompt triggers the safety filter \u2014 even for benign requests.${nl}${nl}` +
		`Suggestions:${nl}` +
		`  \u2022 Rephrase the task description${nl}` +
		`  \u2022 Avoid prompts about current events, news, or controversial topics${nl}` +
		`  \u2022 Try a different model (e.g., claude-sonnet-4-6)${nl}` +
		`  \u2022 If using custom system prompt, review it for content that may trigger filters`
	);
}
