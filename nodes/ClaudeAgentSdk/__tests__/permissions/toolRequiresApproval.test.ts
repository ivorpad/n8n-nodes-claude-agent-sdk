/**
 * toolRequiresApproval — regression tests
 *
 * Tests every approval scope to prevent regressions in the
 * tool-to-approval-required mapping.
 */

import { describe, expect, it } from 'vitest';

import { toolRequiresApproval, type ApprovalConfig } from '../../permissions/approvalProperties';

function makeConfig(overrides: Partial<ApprovalConfig> = {}): ApprovalConfig {
	return {
		enabled: true,
		mode: 'pauseForApproval',
		scope: 'notAllowed',
		specificTools: [],
		approvalMatchMode: 'tool',
		timeoutSeconds: 3600,
		defaultOnTimeout: 'deny',
		handleAskUserQuestion: true,
		sdkOwnsWaitResume: true,
		allowPermissionModeOverride: false,
		allowedOverrideModes: [],
		hitlWebhookAuthentication: 'none',
		hitlWebhookResponderIdentity: 'none',
		hitlWebhookIdentityHeaderName: 'x-auth-request-email',
		hitlWebhookIdentityJwtClaim: 'sub',
		...overrides,
	};
}

describe('toolRequiresApproval', () => {
	it('returns false when config.enabled is false', () => {
		expect(toolRequiresApproval('Bash', makeConfig({ enabled: false }), [])).toBe(false);
	});

	describe('scope: notAllowed', () => {
		const config = makeConfig({ scope: 'notAllowed' });

		it('requires approval for tools NOT in allowed list', () => {
			expect(toolRequiresApproval('Bash', config, ['Read', 'Glob'])).toBe(true);
			expect(toolRequiresApproval('Write', config, ['Read'])).toBe(true);
		});

		it('does NOT require approval for tools in allowed list', () => {
			expect(toolRequiresApproval('Read', config, ['Read', 'Glob'])).toBe(false);
			expect(toolRequiresApproval('Glob', config, ['Read', 'Glob'])).toBe(false);
		});
	});

	describe('scope: fileOps', () => {
		const config = makeConfig({ scope: 'fileOps' });

		it('requires approval for Write, Edit, NotebookEdit', () => {
			expect(toolRequiresApproval('Write', config, [])).toBe(true);
			expect(toolRequiresApproval('Edit', config, [])).toBe(true);
			expect(toolRequiresApproval('NotebookEdit', config, [])).toBe(true);
		});

		it('does NOT require approval for Bash, Read, Glob', () => {
			expect(toolRequiresApproval('Bash', config, [])).toBe(false);
			expect(toolRequiresApproval('Read', config, [])).toBe(false);
			expect(toolRequiresApproval('Glob', config, [])).toBe(false);
		});
	});

	describe('scope: bash', () => {
		const config = makeConfig({ scope: 'bash' });

		it('requires approval for Bash only', () => {
			expect(toolRequiresApproval('Bash', config, [])).toBe(true);
		});

		it('does NOT require approval for Write, Edit, Read', () => {
			expect(toolRequiresApproval('Write', config, [])).toBe(false);
			expect(toolRequiresApproval('Edit', config, [])).toBe(false);
			expect(toolRequiresApproval('Read', config, [])).toBe(false);
		});
	});

	describe('scope: specific', () => {
		const config = makeConfig({
			scope: 'specific',
			specificTools: ['WebFetch', 'WebSearch'],
		});

		it('requires approval for tools in specificTools', () => {
			expect(toolRequiresApproval('WebFetch', config, [])).toBe(true);
			expect(toolRequiresApproval('WebSearch', config, [])).toBe(true);
		});

		it('does NOT require approval for tools not in specificTools', () => {
			expect(toolRequiresApproval('Bash', config, [])).toBe(false);
			expect(toolRequiresApproval('Write', config, [])).toBe(false);
			expect(toolRequiresApproval('Read', config, [])).toBe(false);
		});
	});

	describe('unknown scope', () => {
		it('returns false for unrecognized scope', () => {
			const config = makeConfig({ scope: 'unknown_scope' as any });
			expect(toolRequiresApproval('Bash', config, [])).toBe(false);
		});
	});
});
