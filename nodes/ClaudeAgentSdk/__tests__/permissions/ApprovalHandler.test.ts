/**
 * ApprovalHandler regression tests
 *
 * Covers fingerprint modes, URL generation, serialization,
 * and the permission mode override path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';

import { ApprovalHandler, createApprovalHandler } from '../../permissions/ApprovalHandler';

function createMockExec(): ReturnType<typeof mock<IExecuteFunctions>> {
	const exec = mock<IExecuteFunctions>();
	exec.evaluateExpression.mockReturnValue('https://n8n.test/webhook-waiting/123?signature=tok123');
	exec.getNode.mockReturnValue({ id: 'node-1', name: 'Test', type: 'test', typeVersion: 1, position: [0, 0], parameters: {} } as never);
	exec.putExecutionToWait.mockResolvedValue(undefined as never);
	return exec;
}

describe('ApprovalHandler', () => {
	let exec: ReturnType<typeof createMockExec>;
	let handler: ApprovalHandler;

	beforeEach(() => {
		exec = createMockExec();
		handler = new ApprovalHandler(exec, 0);
	});

	// ─── Request ID generation ──────────────────────────────────────────

	describe('generateRequestId', () => {
		it('matches the approval_<timestamp>_<random> shape', () => {
			const id = handler.generateRequestId();
			// timestamp is base36 of Date.now(); random is a base36/hex token.
			expect(id).toMatch(/^approval_[0-9a-z]+_[0-9a-z]+$/);
		});

		it('uses a high-entropy random component (CSPRNG, not Math.random slice)', () => {
			// Math.random().toString(36).slice(2, 9) yields <= 7 chars and can be
			// much shorter when the fractional part has trailing zeros. A CSPRNG
			// component must be long and fixed-width so it cannot be guessed/forged.
			const random = handler.generateRequestId().split('_')[2];
			expect(random.length).toBeGreaterThanOrEqual(16);
		});

		it('produces unique IDs across many calls', () => {
			const ids = new Set<string>();
			for (let i = 0; i < 1000; i += 1) {
				ids.add(handler.generateRequestId());
			}
			expect(ids.size).toBe(1000);
		});
	});

	// ─── Fingerprint: tool mode ─────────────────────────────────────────

	describe('computeFingerprint — tool mode (default)', () => {
		it('returns tool:<name> regardless of input', () => {
			const fp1 = handler.computeFingerprint('Bash', { command: 'echo hello' });
			const fp2 = handler.computeFingerprint('Bash', { command: 'rm -rf /' });
			expect(fp1).toBe('tool:Bash');
			expect(fp2).toBe('tool:Bash');
			expect(fp1).toBe(fp2);
		});

		it('differentiates between tool names', () => {
			expect(handler.computeFingerprint('Bash', {})).not.toBe(
				handler.computeFingerprint('Write', {}),
			);
		});
	});

	// ─── Fingerprint: tool+input mode ───────────────────────────────────

	describe('computeFingerprint — tool+input mode', () => {
		let inputHandler: ApprovalHandler;

		beforeEach(() => {
			inputHandler = new ApprovalHandler(exec, 0, {
				approvalMatchMode: 'tool+input',
			});
		});

		it('produces different fingerprints for different inputs', () => {
			const fp1 = inputHandler.computeFingerprint('Bash', { command: 'echo hello' });
			const fp2 = inputHandler.computeFingerprint('Bash', { command: 'echo world' });
			expect(fp1).not.toBe(fp2);
		});

		it('produces identical fingerprints for identical inputs', () => {
			const fp1 = inputHandler.computeFingerprint('Write', {
				file_path: '/tmp/a.txt',
				content: 'hello',
			});
			const fp2 = inputHandler.computeFingerprint('Write', {
				file_path: '/tmp/a.txt',
				content: 'hello',
			});
			expect(fp1).toBe(fp2);
		});

		it('normalizes key order so {a,b} == {b,a}', () => {
			const fp1 = inputHandler.computeFingerprint('Write', {
				content: 'hello',
				file_path: '/tmp/a.txt',
			});
			const fp2 = inputHandler.computeFingerprint('Write', {
				file_path: '/tmp/a.txt',
				content: 'hello',
			});
			expect(fp1).toBe(fp2);
		});

		it('handles nested objects deterministically', () => {
			const fp1 = inputHandler.computeFingerprint('Custom', {
				config: { b: 2, a: 1 },
			});
			const fp2 = inputHandler.computeFingerprint('Custom', {
				config: { a: 1, b: 2 },
			});
			expect(fp1).toBe(fp2);
		});

		it('handles null and undefined inputs', () => {
			const fp1 = inputHandler.computeFingerprint('Tool', { key: null });
			const fp2 = inputHandler.computeFingerprint('Tool', { key: undefined });
			// null and undefined produce different fingerprints
			expect(fp1).not.toBe(fp2);
		});

		it('includes tool:<name>:input: prefix', () => {
			const fp = inputHandler.computeFingerprint('Bash', { command: 'ls' });
			expect(fp).toMatch(/^tool:Bash:input:[0-9a-f]{16}$/);
		});
	});

	// ─── Approved fingerprints ──────────────────────────────────────────

	describe('approval tracking', () => {
		it('marks a fingerprint as approved', () => {
			handler.markApproved('tool:Bash');
			expect(handler.isApproved('tool:Bash')).toBe(true);
			expect(handler.isApproved('tool:Write')).toBe(false);
		});

		it('marks multiple fingerprints', () => {
			handler.markMultipleApproved(['tool:Bash', 'tool:Write']);
			expect(handler.isApproved('tool:Bash')).toBe(true);
			expect(handler.isApproved('tool:Write')).toBe(true);
			expect(handler.isApproved('tool:Edit')).toBe(false);
		});

		it('isToolCallApproved checks fingerprint from tool+input', () => {
			handler.markApproved('tool:Bash');
			expect(handler.isToolCallApproved('Bash', { command: 'anything' })).toBe(true);
			expect(handler.isToolCallApproved('Write', { file_path: '/tmp' })).toBe(false);
		});
	});

	// ─── Serialization ──────────────────────────────────────────────────

	describe('fingerprint serialization/deserialization', () => {
		it('round-trips through base64', () => {
			handler.markMultipleApproved(['tool:Bash', 'tool:Write']);
			const serialized = handler.serializeApprovedFingerprints();
			const deserialized = ApprovalHandler.deserializeApprovedFingerprints(serialized);
			expect(deserialized).toContain('tool:Bash');
			expect(deserialized).toContain('tool:Write');
		});

		it('returns empty string when no fingerprints', () => {
			expect(handler.serializeApprovedFingerprints()).toBe('');
		});

		it('deserialize returns empty array for empty string', () => {
			expect(ApprovalHandler.deserializeApprovedFingerprints('')).toEqual([]);
		});

		it('deserialize returns empty array for invalid base64', () => {
			expect(ApprovalHandler.deserializeApprovedFingerprints('not-valid-base64!!!')).toEqual([]);
		});

		it('deserialize returns empty array for non-array JSON', () => {
			const encoded = Buffer.from(JSON.stringify({ a: 1 })).toString('base64');
			expect(ApprovalHandler.deserializeApprovedFingerprints(encoded)).toEqual([]);
		});
	});

	// ─── URL generation ─────────────────────────────────────────────────

	describe('createApprovalUrls', () => {
		it('generates approve and deny URLs', () => {
			const urls = handler.createApprovalUrls('req_1', 'tool:Bash');
			expect(urls.approveUrl).toContain('approved=true');
			expect(urls.denyUrl).toContain('approved=false');
			expect(urls.approveUrl).toContain('requestId=req_1');
			expect(urls.denyUrl).toContain('requestId=req_1');
		});

		it('includes fingerprint when provided', () => {
			const urls = handler.createApprovalUrls('req_1', 'tool:Bash');
			expect(urls.approveUrl).toContain('fp=');
		});

		it('includes sessionId when provided', () => {
			const urls = handler.createApprovalUrls('req_1', undefined, undefined, 'sess_1');
			expect(urls.approveUrl).toContain('sid=sess_1');
		});

		it('includes resumeSessionAt when provided', () => {
			const urls = handler.createApprovalUrls('req_1', undefined, undefined, undefined, 'msg_uuid');
			expect(urls.approveUrl).toContain('rsat=msg_uuid');
		});

		it('includes approved fingerprints when present', () => {
			handler.markApproved('tool:Bash');
			const urls = handler.createApprovalUrls('req_2', 'tool:Write');
			expect(urls.approveUrl).toContain('afps=');
		});

		it('omits optional params when not provided', () => {
			const urls = handler.createApprovalUrls('req_1');
			// fp, task, sid, rsat, afps should not appear
			expect(urls.approveUrl).not.toContain('fp=');
			expect(urls.approveUrl).not.toContain('sid=');
			expect(urls.approveUrl).not.toContain('rsat=');
		});
	});

	describe('createQuestionUrl', () => {
		it('includes type=question param', () => {
			const url = handler.createQuestionUrl('req_q');
			expect(url).toContain('type=question');
		});

		it('encodes questions as base64 in q param', () => {
			const questions = [
				{ question: 'Color?', header: 'Color', options: [{ label: 'Red', description: '' }], multiSelect: false },
			];
			const url = handler.createQuestionUrl('req_q', undefined, undefined, questions);
			expect(url).toContain('q=');
		});

		it('includes resumeSessionAt when provided', () => {
			const url = handler.createQuestionUrl('req_q', undefined, undefined, undefined, 'msg_uuid');
			expect(url).toContain('rsat=msg_uuid');
		});
	});

	describe('createApprovalUrlsWithModeOverride', () => {
		it('generates URLs with permissionMode param for each mode', () => {
			const urls = handler.createApprovalUrlsWithModeOverride(
				'req_1',
				['acceptEdits', 'bypassPermissions'],
				'tool:Bash',
			);

			expect(urls.approveUrl_acceptEdits).toContain('permissionMode=acceptEdits');
			expect(urls.approveUrl_bypassPermissions).toContain('permissionMode=bypassPermissions');
			expect(urls.approveUrl).toContain('approved=true');
			expect(urls.approveUrl).not.toContain('permissionMode=');
			expect(urls.denyUrl).toContain('approved=false');
		});
	});

	// ─── Wait/timeout ───────────────────────────────────────────────────

	describe('computeWaitTill', () => {
		it('returns future date based on timeout', () => {
			const handler60 = new ApprovalHandler(exec, 0, {
				defaultTimeoutMs: 60_000,
			});
			const waitTill = handler60.computeWaitTill();
			expect(waitTill.getTime()).toBeGreaterThan(Date.now());
			expect(waitTill.getTime()).toBeLessThanOrEqual(Date.now() + 60_000 + 100);
		});

		it('returns far-future date for zero timeout (unlimited)', () => {
			const handlerUnlimited = new ApprovalHandler(exec, 0, {
				defaultTimeoutMs: 0,
			});
			const waitTill = handlerUnlimited.computeWaitTill();
			expect(waitTill.getFullYear()).toBe(3000);
		});
	});

	describe('pauseForApproval', () => {
		it('calls putExecutionToWait', async () => {
			await handler.pauseForApproval();
			expect(exec.putExecutionToWait).toHaveBeenCalledOnce();
		});
	});

	describe('pauseWithTimeout', () => {
		it('calls putExecutionToWait with custom timeout', async () => {
			await handler.pauseWithTimeout(5_000);
			expect(exec.putExecutionToWait).toHaveBeenCalledOnce();
			const arg = exec.putExecutionToWait.mock.calls[0][0] as Date;
			expect(arg.getTime()).toBeGreaterThan(Date.now());
			expect(arg.getTime()).toBeLessThanOrEqual(Date.now() + 5_000 + 100);
		});
	});

	// ─── Factory function ───────────────────────────────────────────────

	describe('createApprovalHandler factory', () => {
		it('creates an ApprovalHandler with default config', () => {
			const h = createApprovalHandler(exec, 0);
			expect(h).toBeInstanceOf(ApprovalHandler);
			const config = h.getConfig();
			expect(config.approvalMatchMode).toBe('tool');
		});

		it('merges partial config', () => {
			const h = createApprovalHandler(exec, 0, {
				approvalMatchMode: 'tool+input',
				defaultTimeoutMs: 120_000,
			});
			const config = h.getConfig();
			expect(config.approvalMatchMode).toBe('tool+input');
			expect(config.defaultTimeoutMs).toBe(120_000);
			expect(config.defaultOnTimeout).toBe('deny'); // default preserved
		});
	});
});
