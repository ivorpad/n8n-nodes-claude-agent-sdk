/**
 * Error enrichment helpers for the executeTask execution loops:
 * stderr extraction, known-API-error parsing, and abort detection.
 */

import {
	detectToolsNotSupported,
	isUsagePolicyViolation,
	buildToolsNotSupportedMessage,
	buildUsagePolicyMessage,
} from '../../errorClassification';
import {
	NOOP_SECRETS_REDACTOR,
	type SecretsRedactor,
} from './secretsRedaction';

/**
 * Parse and enhance known API error types with user-friendly messages
 */
function parseApiError(error: unknown, stderr: string): string | null {
	const errorMessage = error instanceof Error ? error.message : String(error);
	const combinedText = `${errorMessage}\n${stderr}`;

	// Check for Anthropic usage policy violation
	if (isUsagePolicyViolation(combinedText)) {
		return buildUsagePolicyMessage();
	}

	// Check for "does not support tools" error (common with Ollama models)
	const modelName = detectToolsNotSupported(error, combinedText);
	if (modelName) {
		return buildToolsNotSupportedMessage(modelName);
	}

	return null;
}

/**
 * Extract stderr from multiple possible sources
 */
function extractStderr(error: unknown, stderrOutput: string[]): string {
	const stderrParts: string[] = [];

	// 1. From the callback-captured array
	const callbackStderr = stderrOutput.join('\n').trim();
	if (callbackStderr) {
		stderrParts.push(callbackStderr);
	}

	// 2. From error object properties (SDK may attach stderr here)
	if (error && typeof error === 'object') {
		const errObj = error as Record<string, unknown>;

		// Check error.stderr
		if (typeof errObj.stderr === 'string' && errObj.stderr.trim()) {
			stderrParts.push(errObj.stderr.trim());
		}

		// Check error.cause.stderr
		if (errObj.cause && typeof errObj.cause === 'object') {
			const cause = errObj.cause as Record<string, unknown>;
			if (typeof cause.stderr === 'string' && cause.stderr.trim()) {
				stderrParts.push(cause.stderr.trim());
			}
		}

		// Check error.output (some process errors include this)
		if (Array.isArray(errObj.output)) {
			const outputStderr = errObj.output
				.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
				.join('\n')
				.trim();
			if (outputStderr) {
				stderrParts.push(outputStderr);
			}
		}
	}

	// Deduplicate and join
	const uniqueParts = [...new Set(stderrParts)];
	return uniqueParts.join('\n').trim();
}

/**
 * Helper to throw error with stderr context for better debugging
 */
export function throwWithStderr(
	error: unknown,
	stderrOutput: string[],
	secretRedactor: SecretsRedactor = NOOP_SECRETS_REDACTOR,
): never {
	// Mask secrets in BOTH the captured stderr and the original error message
	// before they are assembled into the thrown Error — provider keys / secrets
	// echoed by the CLI on a 4xx must not reach n8n logs or the node error output.
	const stderr = secretRedactor.redactString(extractStderr(error, stderrOutput));
	const originalMessage = secretRedactor.redactString(
		error instanceof Error ? error.message : String(error),
	);

	// Try to parse known API errors first
	const userFriendlyMessage = parseApiError(error, stderr);
	if (userFriendlyMessage) {
		throw new Error(userFriendlyMessage);
	}

	// Build enhanced error message with stderr
	let enhancedMessage = originalMessage;
	if (stderr) {
		enhancedMessage = `${originalMessage}\n\nClaude CLI stderr output:\n${stderr}`;
	}

	// Create new error with enhanced message but preserve stack.
	// The stack's first line echoes the original message, so it must be
	// redacted too — otherwise the secret survives in enhancedError.stack.
	const enhancedError = new Error(enhancedMessage);
	if (error instanceof Error && error.stack) {
		enhancedError.stack = secretRedactor.redactString(error.stack);
	}
	// Copy any additional properties from original error
	if (error && typeof error === 'object') {
		const errObj = error as Record<string, unknown>;
		if (errObj.code) (enhancedError as NodeJS.ErrnoException).code = errObj.code as string;
		if (errObj.path) (enhancedError as NodeJS.ErrnoException).path = errObj.path as string;
	}
	throw enhancedError;
}

/**
	* Check if an error is an abort/cancellation error
	*/
export function isAbortError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}
	const err = error as { name?: string; code?: string; message?: string };
	if (err.name === 'AbortError') {
		return true;
	}
	if (err.code === 'ABORT_ERR') {
		return true;
	}
	if (typeof err.message === 'string' && /abort(ed)?/i.test(err.message)) {
		return true;
	}
	return false;
}
