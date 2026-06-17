/**
 * canUseTool Callback Factory
 *
 * Creates a canUseTool callback that integrates with the ApprovalHandler
 * for interactive approval flow. Notifications are delegated to a
 * NotificationChannel (NDJSON, Webhook, Slack, etc.).
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import type { CanUseTool, PermissionResult } from '../sdk/types';
import type { ApprovalHandler } from './ApprovalHandler';
import type { ApprovalConfig } from './approvalProperties';
import { toolRequiresApproval } from './approvalProperties';
import {
	createRuntimePendingState,
	createRuntimeQuestionInteraction,
	createRuntimeApprovalInteraction,
	type RuntimePendingState,
} from '../operations/executeTask/hitlRuntimeState';
import type { PendingHitlResolution } from '../operations/executeTask/types';
import type { HitlInteractionStore } from '../hitl/interactionStore';
import type { PermissionsConfig } from './types';
import { canonicalizeHitlQuestions } from '../hitl/questionPolicy';
import {
	checkPermissionRules,
	isAskUserQuestionInput,
	isAnswerCompatibleWithQuestion,
	normalizeAnswerLookupKey,
	normalizeAnswerValue,
	resolveQueuedAnswerForQuestion,
} from './canUseToolRules';
import type { SharedExecutionState } from './sharedExecutionState';

export type { SharedExecutionState } from './sharedExecutionState';
/**
 * Prefix used in HITL deny messages so the streaming layer can identify and
 * suppress them from the client stream. Exported for use in StreamingHandler.
 */
export const HITL_MESSAGE_PREFIX = '[HITL]';

/**
 * The callback IS the canonical SDK CanUseTool: its options carry
 * toolUseID, title/displayName/description, blockedPath, decisionReason and
 * typed PermissionUpdate suggestions; results are canonical PermissionResult.
 */
type CanUseToolCallback = CanUseTool;
type CanUseToolOptions = Parameters<CanUseTool>[2];


const PENDING_HITL_INTERACTION_MESSAGE =
	`${HITL_MESSAGE_PREFIX} Pending human response for this run. Stop and wait; do not call more tools.`;

// ─────────────────────────────────────────────────────────────────────────────
// Callback Factory
// ─────────────────────────────────────────────────────────────────────────────


interface CreateCanUseToolCallbackParams {
	execFunctions?: IExecuteFunctions;
	approvalHandler: ApprovalHandler;
	approvalConfig: ApprovalConfig;
	streamKey?: string;
	runtimePendingState?: RuntimePendingState;
	interactionStore?: HitlInteractionStore;
	pendingQuestionResponse?: {
		requestId: string;
		answers: Record<string, string | string[]>;
	};
	pendingApprovalResolution?: PendingHitlResolution;
	permissionsConfig: PermissionsConfig;
	allowedTools: string[];
	blockedTools: string[];
	sessionId: string;
	originalTask: string;
	workingDirectory?: string;
	executionId?: string;
	sharedState?: SharedExecutionState;
	/** When set, approval/question notifications are emitted as an in-stream
	 * preview when the tool call is denied for HITL. The execution wait still
	 * belongs to waitForPendingInteractions when sdkOwnsWaitResume is true. */
	immediateNotificationChannel?: import('../notifications/types').NotificationChannel;
}

export function createCanUseToolCallback(
	params: CreateCanUseToolCallbackParams,
): CanUseToolCallback {
	const {
		approvalHandler,
		approvalConfig,
		streamKey,
		runtimePendingState = createRuntimePendingState(),
		interactionStore,
		pendingQuestionResponse,
		pendingApprovalResolution,
		permissionsConfig,
		allowedTools,
		blockedTools,
		sessionId,
		originalTask,
		workingDirectory,
		executionId,
		sharedState,
		immediateNotificationChannel,
	} = params;

	const timeoutMs = approvalConfig.timeoutSeconds * 1000;
	let queuedQuestionResponse = pendingQuestionResponse;
	let queuedApprovalResolution = pendingApprovalResolution;

	return async (
		toolName: string,
		input: Record<string, unknown>,
		options: CanUseToolOptions,
	): Promise<PermissionResult> => {
		// Check if aborted
		if (options.signal.aborted) {
			return {
				behavior: 'deny',
				message: 'Operation aborted',
				interrupt: true,
			};
		}

		// Resolve the current session ID — prefer the live value from execution
		// loop (which reflects the post-fork session ID) over the initial value
		// captured in the closure at callback creation time.
		const effectiveSessionId = sharedState?.sessionId || sessionId;
		const existingPendingInteraction = runtimePendingState.getPendingForExecution(executionId)[0];

		if (existingPendingInteraction) {
			console.warn(
				`[Claude Agent SDK] Suppressing ${toolName} because ` +
				`${existingPendingInteraction.kind}:${existingPendingInteraction.requestId} ` +
				`is already pending for execution ${executionId ?? 'unknown'}`,
			);
			return {
				behavior: 'deny',
				message: PENDING_HITL_INTERACTION_MESSAGE,
				interrupt: true,
				decisionClassification: 'user_temporary',
			};
		}

		// ─────────────────────────────────────────────────────────────────────
		// Handle AskUserQuestion tool specially
		// ─────────────────────────────────────────────────────────────────────
		if (toolName === 'AskUserQuestion' && approvalConfig.handleAskUserQuestion) {
			if (isAskUserQuestionInput(input)) {
				if (queuedQuestionResponse) {
					const queuedAnswers = queuedQuestionResponse.answers;
					const queuedAnswerLookup = new Map<string, string | string[]>();
					for (const [key, value] of Object.entries(queuedAnswers)) {
						const normalizedKey = normalizeAnswerLookupKey(key);
						if (!normalizedKey || queuedAnswerLookup.has(normalizedKey)) {
							continue;
						}
						queuedAnswerLookup.set(normalizedKey, value);
					}
					const mappedAnswers: Record<string, string> = {};

					for (const [questionIndex, question] of input.questions.entries()) {
						const questionText = question.question;
						const rawAnswer = resolveQueuedAnswerForQuestion({
							queuedAnswers,
							queuedAnswerLookup,
							question,
							questionIndex,
						});
						const normalized = normalizeAnswerValue(rawAnswer);
						if (!normalized) continue;
						if (!isAnswerCompatibleWithQuestion(question, normalized)) continue;
						mappedAnswers[questionText] = normalized;
					}

					// Consume once; subsequent AskUserQuestion calls in the same run
					// should follow normal HITL behavior.
					queuedQuestionResponse = undefined;
					if (Object.keys(mappedAnswers).length === input.questions.length) {
						return {
							behavior: 'allow',
							updatedInput: {
								...input,
								questions: input.questions,
								answers: mappedAnswers,
							},
						};
					}
				}

				const requestId = approvalHandler.generateRequestId();
				const canonicalQuestions = canonicalizeHitlQuestions(input.questions);
				const resumeSessionAt = sharedState?.lastAssistantMessageUuidBeforeToolUse
					?? sharedState?.lastAssistantMessageUuid;
				const questionInteraction = createRuntimeQuestionInteraction({
					requestId,
					streamKey,
					questions: canonicalQuestions,
					sessionId: effectiveSessionId || undefined,
					originalTask,
					approvedFingerprints: approvalHandler.serializeApprovedFingerprints(),
					resumeSessionAt,
					timeoutMs,
					executionId,
				});

				if (interactionStore) {
					await interactionStore.saveInteraction({
						requestId,
						kind: 'question',
						status: 'pending',
						createdAt: questionInteraction.createdAt,
						timeoutMs,
						executionId,
						sessionId: effectiveSessionId || undefined,
						streamKey,
						originalTaskBase64: questionInteraction.originalTaskBase64,
						approvedFingerprints: approvalHandler.serializeApprovedFingerprints(),
						resumeSessionAt,
						questions: canonicalQuestions,
					});
				}

				runtimePendingState.addInteraction(questionInteraction);

				// Emit question notification immediately into the stream
				if (immediateNotificationChannel) {
					const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
					const notificationQuestions = canonicalQuestions.map((q) => ({
						question: q.question,
						header: q.header ?? q.question,
						options: (q.options ?? []).map((o) => ({
							label: o.label,
							description: o.description ?? '',
							value: o.value,
							action: o.action,
						})),
						multiSelect: q.multiSelect ?? false,
					}));
					const questionUrl = approvalHandler.createQuestionUrl(
						requestId,
						Buffer.from(originalTask).toString('base64'),
						effectiveSessionId || '',
						notificationQuestions,
						resumeSessionAt,
						streamKey,
					);
					await immediateNotificationChannel.sendQuestion({
						requestId,
						questions: notificationQuestions,
						responseUrl: questionUrl,
						expiresAt,
						sessionId: effectiveSessionId || undefined,
					});
					questionInteraction.notifiedImmediately = true;
				}

				return {
					behavior: 'deny',
					message: `[HITL] Paused — your questions have been sent to the user. The workflow will resume automatically when they respond.`,
					interrupt: true,
					decisionClassification: 'user_temporary',
				};
			}
		}

		// ─────────────────────────────────────────────────────────────────────
		// Consume queued approval resolution (on resume from approval decision)
		// ─────────────────────────────────────────────────────────────────────
		if (queuedApprovalResolution) {
			const resolution = queuedApprovalResolution;
			const currentFingerprint = approvalHandler.computeFingerprint(toolName, input);
			const matchesByFingerprint = resolution.fingerprint && resolution.fingerprint === currentFingerprint;
			const matchesByToolName = resolution.toolName === toolName;

			if (matchesByFingerprint || matchesByToolName) {
				queuedApprovalResolution = undefined;

				if (!resolution.approved) {
					// Denied with feedback — normal deny (no interrupt) so Claude sees
					// the reviewer message as a tool_result error and can adapt.
					return {
						behavior: 'deny',
						message: resolution.reviewerMessage ?? `Tool "${toolName}" was denied by the reviewer.`,
						decisionClassification: 'user_reject',
					};
				}

				// Approved — possibly with modified input from reviewer
				const candidateInput = resolution.updatedInput ?? input;

				// Re-check hard safety rules on the (possibly modified) input
				const safetyCheck = checkPermissionRules(
					toolName,
					candidateInput,
					permissionsConfig,
					allowedTools,
					blockedTools,
					workingDirectory,
				);
				if (safetyCheck.decision === 'deny') {
					return {
						behavior: 'deny',
						message: safetyCheck.reason || `Tool "${toolName}" is denied after input modification`,
					};
				}

				if (resolution.fingerprint) {
					approvalHandler.markApproved(resolution.fingerprint);
				}

				return {
					behavior: 'allow',
					updatedInput: candidateInput,
				};
			}
		}

		// ─────────────────────────────────────────────────────────────────────
		// Check if this tool call was already approved (on resume)
		// ─────────────────────────────────────────────────────────────────────
		if (approvalHandler.isToolCallApproved(toolName, input)) {
			return {
				behavior: 'allow',
				updatedInput: input,
				// The fingerprint was explicitly approved by the user for this
				// session — classify as a durable user decision.
				decisionClassification: 'user_permanent',
			};
		}

		// ─────────────────────────────────────────────────────────────────────
		// Check if tool requires interactive approval BEFORE permission rules.
		// This prevents allowedTools in checkPermissionRules() from
		// short-circuiting approval for fileOps/bash/specific scopes.
		// ─────────────────────────────────────────────────────────────────────
		const needsApproval = toolRequiresApproval(toolName, approvalConfig, allowedTools);

		if (needsApproval) {
			// Tool requires approval — but first check if it's explicitly denied
			// (blocked tools / path sandbox / deny rules should still take precedence)
			const permissionCheck = checkPermissionRules(
				toolName,
				input,
				permissionsConfig,
				allowedTools,
				blockedTools,
			);

			if (permissionCheck.decision === 'deny') {
				return {
					behavior: 'deny',
					message: permissionCheck.reason || `Tool "${toolName}" is denied`,
				};
			}
		} else {
			// Tool does NOT require interactive approval — apply normal permission rules
			const permissionCheck = checkPermissionRules(
				toolName,
				input,
				permissionsConfig,
				allowedTools,
				blockedTools,
			);

			if (permissionCheck.decision === 'allow') {
				return {
					behavior: 'allow',
					updatedInput: input,
				};
			}

			if (permissionCheck.decision === 'deny') {
				return {
					behavior: 'deny',
					message: permissionCheck.reason || `Tool "${toolName}" is denied`,
				};
			}

			// Decision is 'ask' but tool doesn't require interactive approval → allow
			return {
				behavior: 'allow',
				updatedInput: input,
			};
		}

		// ─────────────────────────────────────────────────────────────────────
		// Interactive Approval Flow
		// ─────────────────────────────────────────────────────────────────────

		const fingerprint = approvalHandler.computeFingerprint(toolName, input);

		const requestId = approvalHandler.generateRequestId();
		// Best-effort replay anchor for resumeSessionAt. Prefer the message before
		// tool_use when available; otherwise fall back to last seen assistant UUID.
		const resumeSessionAt = sharedState?.lastAssistantMessageUuidBeforeToolUse
			?? sharedState?.lastAssistantMessageUuid;
		const approvalInteraction = createRuntimeApprovalInteraction({
			requestId,
			streamKey,
			fingerprint,
			sessionId: effectiveSessionId || undefined,
			originalTask,
			approvedFingerprints: approvalHandler.serializeApprovedFingerprints(),
			resumeSessionAt,
			timeoutMs,
			toolName,
			toolInput: input,
			executionId,
		});

		if (interactionStore) {
			await interactionStore.saveInteraction({
				requestId,
				kind: 'approval',
				status: 'pending',
				createdAt: approvalInteraction.createdAt,
				timeoutMs,
				executionId,
				sessionId: effectiveSessionId || undefined,
				streamKey,
				fingerprint,
				originalTaskBase64: approvalInteraction.originalTaskBase64,
				approvedFingerprints: approvalHandler.serializeApprovedFingerprints(),
				resumeSessionAt,
				toolName,
				toolInput: input,
			});
		}

		runtimePendingState.addInteraction(approvalInteraction);

		// Emit an in-stream preview so clients can render approve/deny buttons
		// before the execution reaches its authoritative wait state. The deferred
		// notification path skips interactions already previewed this way.
		if (immediateNotificationChannel) {
			const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
			const approvalUrls = approvalHandler.createApprovalUrls(
				requestId,
				fingerprint,
				Buffer.from(originalTask).toString('base64'),
				effectiveSessionId || '',
				resumeSessionAt,
				streamKey,
			);
			await immediateNotificationChannel.sendApproval({
				requestId,
				toolName,
				toolInput: input,
				approveUrl: approvalUrls.approveUrl,
				denyUrl: approvalUrls.denyUrl,
				expiresAt,
				sessionId: effectiveSessionId || undefined,
			});
			approvalInteraction.notifiedImmediately = true;
		}

		return {
			behavior: 'deny',
			message: `[HITL] Paused — the ${toolName} tool requires human approval before it can run. The workflow will resume automatically once the user responds.`,
			interrupt: true,
			decisionClassification: 'user_temporary',
		};
	};
}
