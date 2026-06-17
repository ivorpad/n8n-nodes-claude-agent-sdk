/**
 * Security regression: channel HITL resume must be record-only.
 *
 * n8n's webhook resume token signs only the execution + node path, NOT the
 * query string, so `?sid=&afps=&fp=` are attacker-controllable by anyone who
 * holds a companion approve/deny URL. The fallback record builders must NOT fold
 * those into the record, and buildChannelResumeFields must source resume fields
 * from the persisted record ONLY (empty when there is no record).
 */

import { describe, it, expect } from 'vitest';

import type { PendingCompanionHitlRecord } from '../types';
import {
	buildChannelResumeFields,
	buildFallbackApprovalPendingRecord,
	buildFallbackQuestionPendingRecord,
} from '../webhookHelpers';

describe('fallback pending record builders (record-only safe posture)', () => {
	it('approval fallback carries NO security-relevant fields', () => {
		const record = buildFallbackApprovalPendingRecord({ requestId: 'req_1', channel: 'email' });
		expect(record.requestId).toBe('req_1');
		expect(record.channel).toBe('email');
		expect(record.kind).toBe('approval');
		expect(record.sessionId).toBeUndefined();
		expect(record.approvedFingerprints).toBeUndefined();
		expect(record.fingerprint).toBeUndefined();
	});

	it('question fallback carries only non-authorizing fields', () => {
		const record = buildFallbackQuestionPendingRecord({
			requestId: 'req_2',
			channel: 'slack',
			message: 'pick one',
		});
		expect(record.requestId).toBe('req_2');
		expect(record.message).toBe('pick one');
		expect(record.sessionId).toBeUndefined();
		expect(record.approvedFingerprints).toBeUndefined();
		expect(record.fingerprint).toBeUndefined();
	});
});

describe('buildChannelResumeFields', () => {
	it('returns all-undefined when there is no persisted record (safe posture)', () => {
		expect(buildChannelResumeFields(undefined)).toEqual({
			resumeSessionId: undefined,
			approvedFingerprints: undefined,
			fingerprint: undefined,
		});
	});

	it('sources resume fields from the persisted record only', () => {
		const record: PendingCompanionHitlRecord = {
			requestId: 'req_3',
			kind: 'approval',
			status: 'consumed',
			createdAt: 0,
			timeoutMs: 0,
			sessionId: 'sess-stored',
			approvedFingerprints: 'tool:Write',
			fingerprint: 'fp-stored',
		};
		expect(buildChannelResumeFields(record)).toEqual({
			resumeSessionId: 'sess-stored',
			approvedFingerprints: 'tool:Write',
			fingerprint: 'fp-stored',
		});
	});

	it('does not expose a fingerprint for a question record', () => {
		const record: PendingCompanionHitlRecord = {
			requestId: 'req_4',
			kind: 'question',
			status: 'consumed',
			createdAt: 0,
			timeoutMs: 0,
			sessionId: 'sess',
			approvedFingerprints: 'tool:Write',
			fingerprint: 'should-not-leak',
		};
		expect(buildChannelResumeFields(record).fingerprint).toBeUndefined();
	});
});
