/**
 * ApprovalHandler - Manages approval state and webhook-based decisions
 *
 * Handles fingerprint-based approval tracking and URL generation for
 * the pause/resume flow. Pending request tracking is handled by
 * execution-local runtime state.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { createHash, randomBytes } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ApprovalHandlerConfig {
	defaultTimeoutMs: number;
	defaultOnTimeout: 'allow' | 'deny' | 'error';
	approvalMatchMode: 'tool' | 'tool+input';
}

/** Shape of questions passed to createQuestionUrl */
type QuestionDef = Array<{
	question: string;
	header: string;
	options: Array<{
		label: string;
		description: string;
		value?: string;
		action?: 'resume' | 'complete';
	}>;
	multiSelect: boolean;
}>;

const DEFAULT_CONFIG: ApprovalHandlerConfig = {
	defaultTimeoutMs: 3600 * 1000, // 1 hour
	defaultOnTimeout: 'deny',
	approvalMatchMode: 'tool',
};

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalHandler Class
// ─────────────────────────────────────────────────────────────────────────────

export class ApprovalHandler {
	private approvedFingerprints: Set<string> = new Set();
	private config: ApprovalHandlerConfig;

	constructor(
		private execFunctions: IExecuteFunctions,
		_itemIndex: number,
		config?: Partial<ApprovalHandlerConfig>,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Request ID Generation
	// ─────────────────────────────────────────────────────────────────────────

	generateRequestId(): string {
		const timestamp = Date.now().toString(36);
		// Cryptographically secure random component so approval request IDs
		// cannot be guessed or forged by an attacker. 12 bytes -> 24 hex chars.
		const random = randomBytes(12).toString('hex');
		return `approval_${timestamp}_${random}`;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Fingerprint Generation (for tool+input matching)
	// ─────────────────────────────────────────────────────────────────────────

	computeFingerprint(toolName: string, toolInput: Record<string, unknown>): string {
		if (this.config.approvalMatchMode === 'tool') {
			return `tool:${toolName}`;
		}

		// tool+input mode: hash the normalized input
		const normalizedInput = this.normalizeInput(toolInput);
		const inputHash = createHash('sha256')
			.update(JSON.stringify(normalizedInput))
			.digest('hex')
			.slice(0, 16);
		return `tool:${toolName}:input:${inputHash}`;
	}

	private normalizeInput(obj: unknown): unknown {
		if (obj === null || obj === undefined) {
			return obj;
		}
		if (Array.isArray(obj)) {
			return obj.map((item) => this.normalizeInput(item));
		}
		if (typeof obj === 'object') {
			const sorted: Record<string, unknown> = {};
			const keys = Object.keys(obj as Record<string, unknown>).sort();
			for (const key of keys) {
				sorted[key] = this.normalizeInput((obj as Record<string, unknown>)[key]);
			}
			return sorted;
		}
		return obj;
	}

	markApproved(fingerprint: string): void {
		this.approvedFingerprints.add(fingerprint);
	}

	markMultipleApproved(fingerprints: string[]): void {
		for (const fp of fingerprints) {
			this.approvedFingerprints.add(fp);
		}
	}

	getApprovedFingerprints(): string[] {
		return Array.from(this.approvedFingerprints);
	}

	serializeApprovedFingerprints(): string {
		const fingerprints = this.getApprovedFingerprints();
		if (fingerprints.length === 0) return '';
		return Buffer.from(JSON.stringify(fingerprints)).toString('base64');
	}

	static deserializeApprovedFingerprints(encoded: string): string[] {
		if (!encoded) return [];
		try {
			const json = Buffer.from(encoded, 'base64').toString('utf-8');
			const parsed = JSON.parse(json);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	isApproved(fingerprint: string): boolean {
		return this.approvedFingerprints.has(fingerprint);
	}

	isToolCallApproved(toolName: string, toolInput: Record<string, unknown>): boolean {
		const fingerprint = this.computeFingerprint(toolName, toolInput);
		return this.isApproved(fingerprint);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// URL Generation
	//
	// n8n's webhook-waiting validates the resume token (not HMAC signature)
	// for non-SendAndWait nodes. We build URLs using the raw $execution.resumeUrl
	// pattern: webhookWaitingBaseUrl/<executionId>/<nodeId>?signature=<resumeToken>&<params>
	// ─────────────────────────────────────────────────────────────────────────

	private buildResumeUrl(params: Record<string, string>): string {
		// $execution.resumeUrl gives: <base>/<executionId>?signature=<resumeToken>
		// webhook-waiting expects: <base>/<executionId>/<nodeId>?signature=<token>&<params>
		// We append the node ID to the path so the webhook path matcher finds our node.
		const baseResumeUrl = this.execFunctions.evaluateExpression(
			'{{ $execution.resumeUrl }}', 0,
		) as string;
		const url = new URL(baseResumeUrl);
		const nodeId = this.execFunctions.getNode().id;
		// Append nodeId to path (before query params)
		if (!url.pathname.endsWith(nodeId)) {
			url.pathname = url.pathname.replace(/\/$/, '') + '/' + nodeId;
		}
		for (const [key, value] of Object.entries(params)) {
			if (value) url.searchParams.set(key, value);
		}
		return url.toString();
	}

	createApprovalUrls(
		requestId: string,
		fingerprint?: string,
		originalTask?: string,
		sessionId?: string,
		resumeSessionAt?: string,
		streamKey?: string,
	): { approveUrl: string; denyUrl: string } {
		const approvedFps = this.serializeApprovedFingerprints();
		const baseParams: Record<string, string> = {
			requestId,
			...(fingerprint && { fp: fingerprint }),
			...(originalTask && { task: Buffer.from(originalTask).toString('base64') }),
			...(sessionId && { sid: sessionId }),
			...(resumeSessionAt && { rsat: resumeSessionAt }),
			...(streamKey && { streamKey }),
			...(approvedFps && { afps: approvedFps }),
		};
		return {
			approveUrl: this.buildResumeUrl({ ...baseParams, approved: 'true' }),
			denyUrl: this.buildResumeUrl({ ...baseParams, approved: 'false' }),
		};
	}

	createQuestionUrl(
		requestId: string,
		originalTask?: string,
		sessionId?: string,
		questions?: QuestionDef,
		resumeSessionAt?: string,
		streamKey?: string,
	): string {
		const approvedFps = this.serializeApprovedFingerprints();
		return this.buildResumeUrl({
			requestId,
			type: 'question',
			...(originalTask && { task: Buffer.from(originalTask).toString('base64') }),
			...(sessionId && { sid: sessionId }),
			...(resumeSessionAt && { rsat: resumeSessionAt }),
			...(streamKey && { streamKey }),
			...(questions && { q: Buffer.from(JSON.stringify(questions)).toString('base64') }),
			...(approvedFps && { afps: approvedFps }),
		});
	}

	createApprovalUrlsWithModeOverride(
		requestId: string,
		modes: Array<'default' | 'acceptEdits' | 'bypassPermissions'>,
		fingerprint?: string,
		originalTask?: string,
		sessionId?: string,
		streamKey?: string,
	): Record<string, string> {
		const approvedFps = this.serializeApprovedFingerprints();
		const baseParams = {
			requestId,
			...(fingerprint && { fp: fingerprint }),
			...(originalTask && { task: Buffer.from(originalTask).toString('base64') }),
			...(sessionId && { sid: sessionId }),
			...(streamKey && { streamKey }),
			...(approvedFps && { afps: approvedFps }),
		};

		const urls: Record<string, string> = {
			denyUrl: this.buildResumeUrl({
				...baseParams,
				approved: 'false',
			}),
		};

		for (const mode of modes) {
			urls[`approveUrl_${mode}`] = this.buildResumeUrl({
				...baseParams,
				approved: 'true',
				permissionMode: mode,
			});
		}

		urls.approveUrl = this.buildResumeUrl({
			...baseParams,
			approved: 'true',
		});

		return urls;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Execution Control
	// ─────────────────────────────────────────────────────────────────────────

	computeWaitTill(): Date {
		if (this.config.defaultTimeoutMs <= 0) {
			return new Date('3000-01-01T00:00:00.000Z');
		}
		return new Date(Date.now() + this.config.defaultTimeoutMs);
	}

	async pauseForApproval(): Promise<void> {
		const waitTill = this.computeWaitTill();
		await this.execFunctions.putExecutionToWait(waitTill);
	}

	async pauseWithTimeout(timeoutMs: number): Promise<void> {
		const waitTill = new Date(Date.now() + timeoutMs);
		await this.execFunctions.putExecutionToWait(waitTill);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Config Access
	// ─────────────────────────────────────────────────────────────────────────

	getConfig(): ApprovalHandlerConfig {
		return { ...this.config };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

export function createApprovalHandler(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	config?: Partial<ApprovalHandlerConfig>,
): ApprovalHandler {
	return new ApprovalHandler(execFunctions, itemIndex, config);
}
