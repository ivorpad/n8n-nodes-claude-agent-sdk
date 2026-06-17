/**
 * ManagedAgentAdapter — SdkAdapter implementation for Anthropic's
 * hosted Managed Agents infrastructure.
 *
 * Creates a session against a managed agent + environment, opens an
 * SSE stream, sends the user message, and yields SDK-compatible messages
 * via the event mapper.
 */

import Anthropic from '@anthropic-ai/sdk';
import { setTimeout as sleep } from 'node:timers/promises';

import type { AnthropicBeta, FileMetadata } from '@anthropic-ai/sdk/resources/beta/index.js';
import type {
	BetaManagedAgentsStreamSessionEvents,
	BetaManagedAgentsUserCustomToolResultEventParams,
	BetaManagedAgentsUserToolConfirmationEventParams,
} from '@anthropic-ai/sdk/resources/beta/sessions/index.js';

import type { NodeQueryOptions, SdkAdapter, SessionHandle, QueryHandle } from '../sdk/types';
import type { ManagedAgentConfig, ManagedAgentRawEvent, ManagedStreamMessage } from './types';
import { createManagedEventMapper } from './eventMapper';
import { buildManagedSessionCreateParams } from './configuration';

type ThreadRoutedCustomToolResultEvent = BetaManagedAgentsUserCustomToolResultEventParams & {
	session_thread_id?: string | null;
};

type ThreadRoutedToolConfirmationEvent = BetaManagedAgentsUserToolConfirmationEventParams & {
	session_thread_id?: string | null;
};

export class ManagedAgentAdapter implements SdkAdapter {
	readonly version = 'managed' as const;

	private readonly config: ManagedAgentConfig;

	constructor(config: ManagedAgentConfig) {
		this.config = config;
	}

	async createSession(): Promise<SessionHandle> {
		throw new Error(
			'ManagedAgentAdapter does not support session handles. Use promptOnce().',
		);
	}

	async resumeSession(): Promise<SessionHandle> {
		throw new Error(
			'ManagedAgentAdapter does not support session handles. Use promptOnce().',
		);
	}

	/**
	 * Execute a one-shot prompt via Managed Agents.
	 *
	 * Flow:
	 * 1. Resolve resume session ID (if any); otherwise create a session
	 *    against the pre-existing agent + environment.
	 * 2. Open the SSE event stream.
	 * 3. Send the user message.
	 * 4. Yield SDK-compatible messages until session goes idle/terminated.
	 */
	promptOnce(prompt: string, options: NodeQueryOptions): QueryHandle {
		const config = this.config;
		let activeClient: Anthropic | undefined;
		let activeSessionId: string | undefined;
		let interruptSent = false;

		const markActiveSession = (sessionId: string): void => {
			activeSessionId = sessionId;
			interruptSent = false;
		};

		const sendInterrupt = async (): Promise<void> => {
			if (!activeSessionId || interruptSent) return;
			const client = activeClient ?? new Anthropic({ apiKey: config.apiKey });
			interruptSent = true;
			try {
				await client.beta.sessions.events.send(activeSessionId, {
					events: [{ type: 'user.interrupt' as const }],
				});
			} catch (err) {
				interruptSent = false;
				throw err;
			}
		};

		// Resume paths (resumeWithToolResult, resumeSessionId, or runtime override)
		// don't need agent/environment IDs — they operate on an existing session.
		const hasResumeWithToolResult = Boolean(
			config.resumeWithToolResult || options.managedResumeWithToolResult,
		);
		const hasResumeWithToolConfirmation = Boolean(
			config.resumeWithToolConfirmation || options.managedResumeWithToolConfirmation,
		);
		const hasResumeSession = Boolean(
			config.resumeSessionId || options.managedAgentResumeSessionId,
		);
		const isResumeOnly = hasResumeWithToolResult || hasResumeWithToolConfirmation || hasResumeSession;

		if (!config.agentId && !isResumeOnly) {
			throw new Error(
				'Managed Agent backend requires an agent ID. Pick one from the Agent dropdown, ' +
				'or create one at https://platform.claude.com/workspaces/default/agents and paste the ID.',
			);
		}
		if (!config.environmentId && !isResumeOnly) {
			throw new Error(
				'Managed Agent backend requires an environment ID. Pick one from the Environment dropdown, ' +
				'or create one at https://platform.claude.com/workspaces/default/agents.',
			);
		}

		const stream = (async function* (): AsyncGenerator<ManagedStreamMessage> {
			const client = new Anthropic({
				apiKey: config.apiKey,
			});
			activeClient = client;
			try {
				// ── Custom tool result resume ──────────────────────────────────
				// When resumeWithToolResult is set (either on config or in the
				// promptOnce options bag), the session is already paused
				// server-side at requires_action. We send user.custom_tool_result
				// to unblock it, then re-attach to the SSE stream. No new session
				// is created, no user.message sent.
				// File emission is handled by the next idle cycle if the agent
				// produces files after processing the answer.
				const toolResultResume = options.managedResumeWithToolResult ?? config.resumeWithToolResult;
				if (toolResultResume) {
					const trSessionId = toolResultResume.sessionId;
					markActiveSession(trSessionId);
					const trMapper = createManagedEventMapper(trSessionId);
					const trStream = await client.beta.sessions.events.stream(trSessionId);
					const customToolResultEvent: ThreadRoutedCustomToolResultEvent = {
						type: 'user.custom_tool_result' as const,
						custom_tool_use_id: toolResultResume.customToolUseId,
						content: [
							{
								type: 'text' as const,
								text: toolResultResume.content,
							},
						],
						...(toolResultResume.sessionThreadId
							? { session_thread_id: toolResultResume.sessionThreadId }
							: {}),
					};
					await client.beta.sessions.events.send(trSessionId, {
						events: [customToolResultEvent],
					});

					for await (const rawEvent of trStream) {
						const event: BetaManagedAgentsStreamSessionEvents = rawEvent;
						const messages = trMapper.map(event);
						for (const msg of messages) {
							yield msg;
						}
						if (event.type === 'session.status_idle' || event.type === 'session.status_terminated') {
							break;
						}
					}
					return;
				}

				// ── Tool confirmation resume ───────────────────────────────────
				// Permission-policy pauses are resolved with user.tool_confirmation.
				// Keep this separate from custom-tool answers: the wire events have
				// different IDs and semantics.
				const toolConfirmationResume =
					options.managedResumeWithToolConfirmation ?? config.resumeWithToolConfirmation;
				if (toolConfirmationResume) {
					const confirmationSessionId = toolConfirmationResume.sessionId;
					markActiveSession(confirmationSessionId);
					const confirmationMapper = createManagedEventMapper(confirmationSessionId);
					const confirmationStream = await client.beta.sessions.events.stream(confirmationSessionId);
					const confirmationEvent: ThreadRoutedToolConfirmationEvent = {
						type: 'user.tool_confirmation' as const,
						tool_use_id: toolConfirmationResume.toolUseId,
						result: toolConfirmationResume.approved ? 'allow' : 'deny',
						...(!toolConfirmationResume.approved && toolConfirmationResume.denyMessage
							? { deny_message: toolConfirmationResume.denyMessage }
							: {}),
						...(toolConfirmationResume.sessionThreadId
							? { session_thread_id: toolConfirmationResume.sessionThreadId }
							: {}),
					};
					await client.beta.sessions.events.send(confirmationSessionId, {
						events: [confirmationEvent],
					});

					for await (const rawEvent of confirmationStream) {
						const event: BetaManagedAgentsStreamSessionEvents = rawEvent;
						const messages = confirmationMapper.map(event);
						for (const msg of messages) {
							yield msg;
						}
						if (event.type === 'session.status_idle' || event.type === 'session.status_terminated') {
							break;
						}
					}
					return;
				}

				// ── Normal message flow ────────────────────────────────────────
				// Resolve resume session ID: promptOnce options override config
				// (promptOnce options carries session-memory state per invocation)
				const resumeSessionId = options.managedAgentResumeSessionId ?? config.resumeSessionId;

				let sessionId: string;
				let eventStream: Awaited<ReturnType<typeof client.beta.sessions.events.stream>>;

				const createSessionOrThrow = async (): Promise<{ id: string }> => {
					const agentId = config.agentId;
					const environmentId = config.environmentId;
					if (!agentId || !environmentId) {
						throw new Error(
							'Managed Agent backend requires an agent ID and environment ID to create a fresh session.',
						);
					}
					try {
						return await client.beta.sessions.create(buildManagedSessionCreateParams({
							agentId,
							environmentId,
							agentVersion: config.agentVersion,
							title: config.sessionTitle,
							metadata: config.sessionMetadata,
							vaultIds: config.vaultIds,
							resources: config.resources,
						}));
					} catch (err) {
						throw wrapManagedAgentError(err, {
							operation: 'sessions.create',
							agentId,
							environmentId,
						});
					}
				};

				if (resumeSessionId) {
					// Resume existing session — skip create, open stream on the stored ID.
					// If the stored session is stale (404/410/deleted), fall back to creating
					// a new session and log the recovery.
					try {
						eventStream = await client.beta.sessions.events.stream(resumeSessionId);
						sessionId = resumeSessionId;
					} catch (err) {
						console.warn(
							`[ManagedAgent] Resume failed for ${resumeSessionId} (${err instanceof Error ? err.message : String(err)}); creating fresh session`,
						);
						const session = await createSessionOrThrow();
						sessionId = session.id;
						eventStream = await client.beta.sessions.events.stream(sessionId);
					}
				} else {
					// Fresh run — create a session against the pre-existing agent + env.
					const session = await createSessionOrThrow();
					sessionId = session.id;
					eventStream = await client.beta.sessions.events.stream(sessionId);
				}
				markActiveSession(sessionId);

				// 4. Send user message
				await client.beta.sessions.events.send(sessionId, {
					events: [
						{
							type: 'user.message' as const,
							content: [{ type: 'text' as const, text: prompt }],
						},
					],
				});

				// 5. Yield mapped events
				// Capture turn boundary from session.status_running.processed_at —
				// the authoritative server-side timestamp for "this turn started here".
				// created_at on session files uses the same clock, so filtering
				// created_at >= turnStartIso surfaces exactly the files produced
				// during this turn. No wall-clock skew, no basename heuristics.
				let turnStartIso: string | undefined;
				let reachedIdle = false;
				const mapper = createManagedEventMapper(sessionId);
				for await (const rawEvent of eventStream) {
					const event: ManagedAgentRawEvent = rawEvent;

					if (event.type === 'session.status_running' && !turnStartIso) {
						turnStartIso = event.processed_at;
					}

					const messages = mapper.map(event);
					for (const msg of messages) {
						yield msg;
					}

					// Stop on terminal events
					if (event.type === 'session.status_idle') {
						reachedIdle = true;
						break;
					}
					if (event.type === 'session.status_terminated') {
						break;
					}
				}

				// 6. After idle, fetch session-scoped files and emit as artifacts
				if (reachedIdle) {
					// Files are synced from /mnt/session/outputs/ asynchronously (~1-3s).
					// Poll until stable. Must combine beta headers: files-api + managed-agents.
					const FILE_BETAS = ['files-api-2025-04-14', 'managed-agents-2026-04-01'] satisfies Array<AnthropicBeta>;
					try {
						const listFiles = async (): Promise<FileMetadata[]> => {
							const filesPage = await client.beta.files.list({
								scope_id: sessionId,
								betas: FILE_BETAS,
							});
							const acc: FileMetadata[] = [];
							for await (const f of filesPage) acc.push(f);
							return acc;
						};
						const deadline = Date.now() + 15000; // 15s max wait
						let collected: FileMetadata[] = [];
						let last: FileMetadata[] = [];
						while (Date.now() < deadline) {
							collected = await listFiles();
							if (collected.length > 0 && collected.length === last.length) break;
							last = collected;
							await sleep(1500);
						}
						// Filter to files created during THIS turn.
						// Uses server-side created_at vs session.status_running.processed_at —
						// both generated by the Managed Agents API, no clock skew.
						// Files from earlier turns stay in the persistent file drawer
						// (rendered by the client from the full session.files list).
						const filesToEmit = turnStartIso
							? collected.filter((f) => f.created_at >= turnStartIso)
							: collected;
						for (const file of filesToEmit) {
							try {
								const response = await client.beta.files.download(file.id, {
									betas: FILE_BETAS,
								});
								const blob = await response.blob();
								const buffer = Buffer.from(await blob.arrayBuffer());
								const base64 = buffer.toString('base64');
								yield {
									type: 'artifact',
									session_id: sessionId,
									content: {
										type: 'file',
										fileId: file.id,
										filename: file.filename,
										mimeType: file.mime_type,
										sizeBytes: file.size_bytes,
										base64,
									},
								};
							} catch (err) {
								console.warn('[ManagedAgent] Failed to download', file.id, err);
							}
						}

						// Emit the full session file list (metadata only — no base64)
						// for the persistent file drawer. The client renders this as a
						// "files in this conversation" side panel. Stable, cheap, no
						// re-downloading. Per-turn pills above + drawer = complete picture.
						if (collected.length > 0) {
							yield {
								type: 'session_files',
								session_id: sessionId,
								content: {
									files: collected.map((f) => ({
										fileId: f.id,
										filename: f.filename,
										mimeType: f.mime_type,
										sizeBytes: f.size_bytes,
										createdAt: f.created_at,
									})),
								},
							};
						}
					} catch (err) {
						console.warn('[ManagedAgent] Failed to list session files:', err);
					}
				}
			} finally {
				activeSessionId = undefined;
				activeClient = undefined;
			}
		})();

		return Object.assign(stream, {
			interrupt: sendInterrupt,
			close: async () => {
				// Stream cleanup handled by for-await-of break
			},
		});
	}
}

/**
 * Wrap an SDK APIError (or any thrown value) with operation context.
 *
 * n8n's log pipeline and the Anthropic SDK's default `toString()` surface the
 * raw response body with line wrapping, which hides the actual server message.
 * This helper extracts the nested `error.error.message` + request id, tags on
 * the selected agent/environment IDs, and adds a stale-selection hint on 404s
 * so the user knows exactly which dropdown to re-pick from.
 */
function wrapManagedAgentError(
	err: unknown,
	ctx: { operation: string; agentId?: string; environmentId?: string },
): Error {
	// Duck-type the Anthropic APIError (dynamic import makes instanceof awkward)
	const maybeApi = err as
		| {
				status?: number;
				error?: {
					error?: { type?: string; message?: string };
					request_id?: string;
				};
				requestID?: string | null;
			}
		| null
		| undefined;

	if (maybeApi && typeof maybeApi.status === 'number' && maybeApi.error) {
		const apiMessage = maybeApi.error?.error?.message ?? 'Unknown error';
		const apiType = maybeApi.error?.error?.type ?? 'error';
		const requestId = maybeApi.requestID ?? maybeApi.error?.request_id ?? 'unknown';
		const tail = `[${apiType} ${maybeApi.status} · request_id=${requestId} · agent=${ctx.agentId ?? 'n/a'} · environment=${ctx.environmentId ?? 'n/a'}]`;

		// Lead with the actionable hint on 404s so the critical instruction
		// survives terminal log wrapping/truncation.
		//
		// Three common causes for a 404 on sessions.create even though
		// agents/environments.retrieve returns 200:
		//   1. The resource is archived (archived_at != null).
		//   2. The stored ID belongs to a different workspace than the
		//      current Claude API credential.
		//   3. The credential was minted via Claude Code `/login` API Usage
		//      Billing against a "Claude Code" workspace. That key class
		//      CAN list/create/retrieve agents+environments but CANNOT
		//      create sessions — the sessions endpoint is hard-gated.
		//      Fix: use a workspace key from a non-"Claude Code" workspace.
		if (maybeApi.status === 404) {
			const lower = apiMessage.toLowerCase();
			if (lower.includes('environment')) {
				return new Error(
					`STALE ENVIRONMENT: sessions.create rejected ${ctx.environmentId}. ` +
						`Possible causes (in order of likelihood): (a) the environment is archived, ` +
						`(b) it belongs to a different workspace than the current Claude API credential, ` +
						`(c) the credential is a Claude-Code-workspace key (minted via /login API Usage Billing) ` +
						`which can CRUD envs/agents but cannot create sessions — use a regular workspace key instead. ` +
						`Open the node, re-pick from the Environment dropdown, and save. ` +
						`API said: ${apiMessage} ${tail}`,
				);
			}
			if (lower.includes('agent')) {
				return new Error(
					`STALE AGENT: sessions.create rejected ${ctx.agentId}. ` +
						`Possible causes (in order of likelihood): (a) the agent is archived, ` +
						`(b) it belongs to a different workspace than the current Claude API credential, ` +
						`(c) the credential is a Claude-Code-workspace key (minted via /login API Usage Billing) ` +
						`which can CRUD envs/agents but cannot create sessions — use a regular workspace key instead. ` +
						`Open the node, re-pick from the Agent dropdown, and save. ` +
						`API said: ${apiMessage} ${tail}`,
				);
			}
		}

		return new Error(`${apiMessage} ${tail}`);
	}

	const idContext = [
		ctx.agentId ? `agent=${ctx.agentId}` : '',
		ctx.environmentId ? `environment=${ctx.environmentId}` : '',
	].filter(Boolean).join(' · ');
	const originalMessage = err instanceof Error ? err.message : String(err);
	return new Error(`Managed Agent ${ctx.operation} failed: ${originalMessage} [${idContext}]`);
}
