/**
 * Error-path secret redaction (V4).
 *
 * The Claude CLI can surface provider keys / secrets inside its stderr output
 * (e.g. echoed request headers on a 4xx). throwWithStderr assembles that stderr
 * into the thrown Error message, which then propagates to n8n logs and the node
 * error output. A secret present in stderr must be masked before it is thrown.
 */
import { describe, expect, it } from 'vitest';

import { executeNonStreaming } from '../../operations/executeTask/execution';
import { createSecretsRedactor } from '../../operations/executeTask/secretsRedaction';

function throwingQuery(error: unknown): AsyncIterable<unknown> {
	return {
		[Symbol.asyncIterator]: async function* () {
			throw error;
			// eslint-disable-next-line no-unreachable
			yield undefined;
		},
	};
}

describe('executeNonStreaming error-path redaction', () => {
	it('masks a secret present in error.stderr before throwing', async () => {
		const secret = 'sk-ant-' + 'stderr-leaked-456';
		const error = Object.assign(new Error('Claude Code process exited with code 1'), {
			stderr: `Error: invalid x-api-key header: ${secret}`,
		});

		await expect(
			executeNonStreaming({
				stderrOutput: [],
				queryResult: throwingQuery(error),
				secretRedactor: createSecretsRedactor([secret]),
			}),
		).rejects.toThrow(/\[REDACTED\]/);

		await expect(
			executeNonStreaming({
				stderrOutput: [],
				queryResult: throwingQuery(error),
				secretRedactor: createSecretsRedactor([secret]),
			}),
		).rejects.not.toThrow(new RegExp(secret));
	});

	it('masks a secret captured in the stderrOutput callback array before throwing', async () => {
		const secret = 'secret-env-value-789';
		const error = new Error('Claude Code process exited with code 1');

		await expect(
			executeNonStreaming({
				stderrOutput: [`leaked DB_PASSWORD=${secret} in subprocess log`],
				queryResult: throwingQuery(error),
				secretRedactor: createSecretsRedactor([secret]),
			}),
		).rejects.toThrow(/\[REDACTED\]/);
	});
});
