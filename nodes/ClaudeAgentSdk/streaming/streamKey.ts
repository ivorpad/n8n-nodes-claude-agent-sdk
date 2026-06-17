import { randomBytes } from 'node:crypto';

/**
 * Build the durable stream key used to address a stream's persisted frames and
 * to authorize replay over the public webhook.
 *
 * SECURITY: the key is a capability — anyone who knows it can replay the entire
 * stream (agent text, tool inputs/outputs) over the replay endpoint, which by
 * default has no extra webhook authentication. `executionId` is a sequential
 * integer and `itemIndex` is small, so a key built from those two alone is
 * trivially ENUMERABLE: an attacker could walk `stream:1:0`, `stream:2:0`, …
 * and exfiltrate other executions' streams. We therefore append a 128-bit
 * random nonce, making the key unguessable even when the replay endpoint is
 * unauthenticated.
 *
 * The nonce is minted ONCE when a stream is first created and then travels with
 * the stream end-to-end: it is returned to the client (agentStreamKey output /
 * resume URL `streamKey` param) and persisted on the interaction record + the
 * durable stream row. On resume the caller passes the full key back
 * (`pendingStreamKey`), so the legitimate replay flow reconstructs it for free
 * — callers that already hold a key pass it via `token`/`existingKey` rather
 * than minting a new one. There must remain exactly ONE site that mints a fresh
 * key per logical stream (operations/executeTask/index.ts), or resume would
 * write to a new key and the client's replay URL would 404.
 */
export function buildDurableStreamKey(args: {
	executionId: string;
	itemIndex: number;
	/** Reuse an explicit nonce instead of minting a new one (resume / tests). */
	token?: string;
}): string {
	const token = args.token ?? randomBytes(16).toString('hex');
	return `stream:${args.executionId}:${args.itemIndex}:${token}`;
}
