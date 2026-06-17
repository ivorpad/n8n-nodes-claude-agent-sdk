type RuntimePendingInteractionKind = 'approval' | 'question';

export interface RuntimePendingInteraction {
	requestId: string;
	kind: RuntimePendingInteractionKind;
	streamKey?: string;
	createdAt: number;
	timeoutMs: number;
	executionId?: string;
	sessionId?: string;
	originalTaskBase64?: string;
	approvedFingerprintsBase64?: string;
	fingerprint?: string;
	resumeSessionAt?: string;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	questionsBase64?: string;
	/** Set to true when the immediate notification channel has already emitted this interaction. */
	notifiedImmediately?: boolean;
}

export function createRuntimeApprovalInteraction(params: {
	requestId: string;
	streamKey?: string;
	fingerprint: string;
	sessionId?: string;
	originalTask?: string;
	approvedFingerprints?: string;
	resumeSessionAt?: string;
	timeoutMs: number;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	executionId?: string;
}): RuntimePendingInteraction {
	return {
		requestId: params.requestId,
		kind: 'approval',
		streamKey: params.streamKey,
		createdAt: Date.now(),
		timeoutMs: params.timeoutMs,
		sessionId: params.sessionId,
		executionId: params.executionId,
		originalTaskBase64: params.originalTask
			? Buffer.from(params.originalTask).toString('base64')
			: undefined,
		approvedFingerprintsBase64: params.approvedFingerprints,
		fingerprint: params.fingerprint,
		resumeSessionAt: params.resumeSessionAt,
		toolName: params.toolName,
		toolInput: params.toolInput,
	};
}

export function createRuntimeQuestionInteraction(params: {
	requestId: string;
	streamKey?: string;
	questions: unknown;
	sessionId?: string;
	originalTask?: string;
	approvedFingerprints?: string;
	resumeSessionAt?: string;
	timeoutMs: number;
	executionId?: string;
}): RuntimePendingInteraction {
	return {
		requestId: params.requestId,
		kind: 'question',
		streamKey: params.streamKey,
		createdAt: Date.now(),
		timeoutMs: params.timeoutMs,
		sessionId: params.sessionId,
		executionId: params.executionId,
		originalTaskBase64: params.originalTask
			? Buffer.from(params.originalTask).toString('base64')
			: undefined,
		approvedFingerprintsBase64: params.approvedFingerprints,
		resumeSessionAt: params.resumeSessionAt,
		questionsBase64: Buffer.from(JSON.stringify(params.questions)).toString('base64'),
	};
}

export interface RuntimePendingState {
	addInteraction(interaction: RuntimePendingInteraction): void;
	getPendingForExecution(executionId?: string): RuntimePendingInteraction[];
	enrichPendingWithSession(args: {
		sessionId: string;
		originalTaskBase64?: string;
		approvedFingerprintsBase64?: string;
		executionId?: string;
	}): void;
}

export function createRuntimePendingState(): RuntimePendingState {
	const pendingByRequestId = new Map<string, RuntimePendingInteraction>();
	return {
		addInteraction(interaction: RuntimePendingInteraction) {
			pendingByRequestId.set(interaction.requestId, interaction);
		},
		getPendingForExecution(executionId?: string): RuntimePendingInteraction[] {
			const all = Array.from(pendingByRequestId.values());
			if (!executionId) {
				return all;
			}
			return all.filter((interaction) => interaction.executionId === executionId);
		},
		enrichPendingWithSession(args: {
			sessionId: string;
			originalTaskBase64?: string;
			approvedFingerprintsBase64?: string;
			executionId?: string;
		}) {
			const { sessionId, originalTaskBase64, approvedFingerprintsBase64, executionId } = args;
			for (const interaction of pendingByRequestId.values()) {
				if (executionId && interaction.executionId !== executionId) continue;
				interaction.sessionId = sessionId;
				if (originalTaskBase64) {
					interaction.originalTaskBase64 = originalTaskBase64;
				}
				if (approvedFingerprintsBase64) {
					interaction.approvedFingerprintsBase64 = approvedFingerprintsBase64;
				}
			}
		},
	};
}
