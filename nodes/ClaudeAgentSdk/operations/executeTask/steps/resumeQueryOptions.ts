import type { NodeQueryOptions } from '../../../sdk/types';

/**
 * A resume request must never carry new-session-only options. The SDK treats
 * sessionId as bootstrap identity and forkSession as a new branch request; both
 * conflict with HITL continuation semantics.
 */
export function applyResumeQueryOptions(
	queryOptions: NodeQueryOptions,
	resumeSessionId: string,
): void {
	queryOptions.resume = resumeSessionId;
	delete queryOptions.sessionId;
	delete queryOptions.title;
	delete queryOptions.forkSession;
}
