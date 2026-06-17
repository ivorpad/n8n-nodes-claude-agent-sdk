import { describe, expect, it } from 'vitest';

import {
	approvalProperties,
	isHitlEnabled,
	parseApprovalConfig,
	resolveHitlPermissionMode,
} from '../../permissions/approvalProperties';

describe('approval properties', () => {
	it('parses disabled interactive approvals', () => {
		const config = parseApprovalConfig(
			(name, _itemIndex, defaultValue) => {
				if (name === 'interactiveApprovals') return 'disabled';
				return defaultValue;
			},
			0,
		);

		expect(config.enabled).toBe(false);
	});

	it('parses enabled interactive approvals', () => {
		const config = parseApprovalConfig(
			(name, _itemIndex, defaultValue) => {
				if (name === 'interactiveApprovals') return 'pauseForApproval';
				return defaultValue;
			},
			0,
		);

		expect(config.enabled).toBe(true);
		expect(config.sdkOwnsWaitResume).toBe(true);
		expect(config.hitlWebhookAuthentication).toBe('none');
		expect(config.hitlWebhookResponderIdentity).toBe('none');
	});

	it('parses sdkOwnsWaitResume override', () => {
		const config = parseApprovalConfig(
			(name, _itemIndex, defaultValue) => {
				if (name === 'interactiveApprovals') return 'pauseForApproval';
				if (name === 'sdkOwnsWaitResume') return false;
				return defaultValue;
			},
			0,
		);

		expect(config.enabled).toBe(true);
		expect(config.sdkOwnsWaitResume).toBe(false);
	});

	it('parses webhook auth and responder identity options', () => {
		const config = parseApprovalConfig(
			(name, _itemIndex, defaultValue) => {
				if (name === 'interactiveApprovals') return 'pauseForApproval';
				if (name === 'hitlWebhookAuthentication') return 'jwtAuth';
				if (name === 'hitlWebhookResponderIdentity') return 'jwtClaim';
				if (name === 'hitlWebhookIdentityJwtClaim') return 'email';
				return defaultValue;
			},
			0,
		);

		expect(config.hitlWebhookAuthentication).toBe('jwtAuth');
		expect(config.hitlWebhookResponderIdentity).toBe('jwtClaim');
		expect(config.hitlWebhookIdentityJwtClaim).toBe('email');
	});

	it('detects when HITL is enabled from the stored mode value', () => {
		expect(isHitlEnabled('pauseForApproval')).toBe(true);
		expect(isHitlEnabled('disabled')).toBe(false);
	});

	it('forces permission mode back to default when HITL is enabled', () => {
		expect(resolveHitlPermissionMode('bypassPermissions', { enabled: true })).toBe('default');
		expect(resolveHitlPermissionMode('acceptEdits', { enabled: false })).toBe('acceptEdits');
	});

	it('defaults Allowed Override Modes to empty so a responder cannot escalate by default', () => {
		// Security default: an HITL approval responder must NOT be able to switch
		// the session into acceptEdits/bypassPermissions unless the operator opts
		// in explicitly. The empty default keeps escalation off until configured.
		const property = approvalProperties.find((entry) => entry.name === 'allowedOverrideModes');

		expect(property).toBeDefined();
		expect(property?.default).toEqual([]);
	});

	it('surfaces a notice when HITL webhook auth is left at the insecure default of none (V8a)', () => {
		// Security (V8a): with auth = none the endpoint relies solely on the n8n
		// resume token. A documented NDV notice must warn the workflow author and
		// recommend a second factor, shown only when HITL is on and auth is none.
		const notice = approvalProperties.find(
			(entry) => entry.name === 'hitlWebhookNoAuthNotice',
		);

		expect(notice).toBeDefined();
		expect(notice?.type).toBe('notice');
		expect(notice?.description).toMatch(/resume token/i);
		expect(notice?.displayOptions?.show?.hitlWebhookAuthentication).toEqual(['none']);
		expect(notice?.displayOptions?.show?.interactiveApprovals).toEqual(['pauseForApproval']);
	});

	it('does not expose interactiveApprovals as an auth-field show dependency', () => {
		const property = approvalProperties.find(
			(entry) => entry.name === 'hitlWebhookAuthentication',
		);

		expect(property).toBeDefined();
		expect(property?.displayOptions?.show?.interactiveApprovals).toBeUndefined();
		expect(property?.displayOptions?.hide?.interactiveApprovals).toEqual([
			{ _cnd: { not: 'pauseForApproval' } },
		]);
	});
});
