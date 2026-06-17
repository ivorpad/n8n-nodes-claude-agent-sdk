/**
 * UI Properties for Interactive Approvals
 *
 * These properties configure the HITL behavior for the SDK node.
 */

import type { INodeProperties } from 'n8n-workflow';
import { TOOL_OPTIONS } from '../toolOptions';

const HITL_ENABLED_VALUES: string[] = ['pauseForApproval'];

export const approvalProperties: INodeProperties[] = [
	// ─────────────────────────────────────────────────────────────────────────
	// Main Toggle
	// ─────────────────────────────────────────────────────────────────────────
	{
		displayName: 'Enable HITL',
		name: 'interactiveApprovals',
		type: 'options',
		options: [
			{
				name: 'Off',
				value: 'disabled',
				description: 'Run without human-in-the-loop pauses',
			},
			{
				name: 'On',
				value: 'pauseForApproval',
				description:
					'Enable human-in-the-loop pauses and emit HITL items on the shared Result output',
			},
		],
		default: 'disabled',
		description: 'Top-level HITL control for approval and question pauses',
		hint:
			'On means the SDK intercepts approval/question tool calls and emits HITL request items. The wait/resume owner is controlled separately by "Pause Execution in SDK".',
	},
	{
		displayName: 'HITL Session Notice',
		name: 'interactiveApprovalsSessionNotice',
		type: 'notice',
		default: '',
		description:
			'HITL requires `Persist Session` to stay enabled. ' +
			'With `Persist Session = false`, execution will fail fast at runtime.',
		displayOptions: {
			show: {
				interactiveApprovals: HITL_ENABLED_VALUES,
				'/additionalOptions.persistSession': [false],
			},
		},
	},
	{
		displayName: 'HITL Permission Mode Notice',
		name: 'interactiveApprovalsPermissionModeNotice',
		type: 'notice',
		default: '',
		description:
			'HITL always runs with `Permission Mode = Default`. ' +
			'If another mode is selected, the node will switch back to Default while HITL is enabled.',
		displayOptions: {
			show: {
				backendMode: ['localCli'],
				interactiveApprovals: HITL_ENABLED_VALUES,
				permissionMode: ['acceptEdits', 'bypassPermissions', 'plan'],
			},
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Approval Scope
	// ─────────────────────────────────────────────────────────────────────────
	{
		displayName: 'Approval Scope',
		name: 'approvalScope',
		type: 'options',
		options: [
			{
				name: 'All Tools Not Explicitly Allowed',
				value: 'notAllowed',
				description: 'Request approval for any tool not in the Allowed Tools list',
			},
			{
				name: 'File Operations Only',
				value: 'fileOps',
				description: 'Request approval for Write, Edit, and file deletion operations',
			},
			{
				name: 'Bash Commands Only',
				value: 'bash',
				description: 'Request approval for Bash command execution',
			},
			{
				name: 'Specific Tools',
				value: 'specific',
				description: 'Request approval for specific tools only',
			},
		],
		default: 'notAllowed',
		description: 'Which tool operations should require interactive approval',
		displayOptions: {
			show: {
				backendMode: ['localCli'],
				interactiveApprovals: HITL_ENABLED_VALUES,
			},
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Specific Tools Selection
	// ─────────────────────────────────────────────────────────────────────────
	{
		displayName: 'Approval Tool Names or IDs',
		name: 'toolsRequiringApproval',
		type: 'multiOptions',
		options: TOOL_OPTIONS,
		typeOptions: {
			loadOptionsMethod: 'listToolOptions',
		},
		default: ['Bash', 'Write', 'Edit'],
		description: 'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: {
			show: {
				backendMode: ['localCli'],
				interactiveApprovals: HITL_ENABLED_VALUES,
				approvalScope: ['specific'],
			},
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Approval Match Mode
	// ─────────────────────────────────────────────────────────────────────────
	{
		displayName: 'Approval Match Mode',
		name: 'approvalMatchMode',
		type: 'options',
		options: [
			{
				name: 'Tool Only (Recommended)',
				value: 'tool',
				description: 'Approve tool for any input in this session. Works reliably with fork/resume.',
			},
			{
				name: 'Tool + Input (Exact)',
				value: 'tool+input',
				description: 'Approve specific tool call with exact input only. May cause re-approval loops if the agent regenerates different content.',
			},
		],
		default: 'tool',
		description:
			'How to match approvals on resume. Tool-only is recommended because fork/resume may regenerate different content.',
		displayOptions: {
			show: {
				backendMode: ['localCli'],
				interactiveApprovals: HITL_ENABLED_VALUES,
			},
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// Timeout Configuration
	// ─────────────────────────────────────────────────────────────────────────
	{
		displayName: 'Approval Timeout',
		name: 'approvalTimeout',
		type: 'number',
		default: 3600,
		description:
			'Maximum seconds to wait for approval (0 = unlimited). After this time, the default action is taken.',
		displayOptions: {
			show: {
				backendMode: ['localCli'],
				interactiveApprovals: HITL_ENABLED_VALUES,
			},
		},
	},
	{
		displayName: 'Default on Timeout',
		name: 'defaultOnTimeout',
		type: 'options',
		options: [
			{
				name: 'Deny',
				value: 'deny',
				description: 'Deny the tool request and continue execution',
			},
			{
				name: 'Allow',
				value: 'allow',
				description: 'Allow the tool request and continue execution',
			},
			{
				name: 'Error',
				value: 'error',
				description: 'Throw an error and stop execution',
			},
		],
		default: 'deny',
		description: 'What to do if approval times out without a response',
		displayOptions: {
			show: {
				backendMode: ['localCli'],
				interactiveApprovals: HITL_ENABLED_VALUES,
			},
		},
	},

	// ─────────────────────────────────────────────────────────────────────────
	// AskUserQuestion Handling
	// ─────────────────────────────────────────────────────────────────────────
	{
		displayName: 'Handle AskUserQuestion',
		name: 'handleAskUserQuestion',
		type: 'boolean',
		default: true,
		description:
			"Whether to pause and wait for responses when Claude uses the AskUserQuestion tool",
		displayOptions: {
			show: {
				backendMode: ['localCli'],
				interactiveApprovals: HITL_ENABLED_VALUES,
			},
		},
	},
	{
		displayName: 'Pause Execution in SDK',
		name: 'sdkOwnsWaitResume',
		type: 'boolean',
		default: true,
		description:
			'Whether the SDK should call putExecutionToWait() directly. Disable when using a channel HITL nodes (Slack/Telegram/...) wired off the SDK Result output.',
		hint:
			'On: SDK calls n8n wait/resume for browser or webhook approvals. Off: SDK only emits the HITL request for a downstream channel node to dispatch and resume.',
		displayOptions: {
			show: {
				interactiveApprovals: HITL_ENABLED_VALUES,
			},
		},
	},
	// ─────────────────────────────────────────────────────────────────────────
	// Permission Mode Override Options
	// ─────────────────────────────────────────────────────────────────────────
	{
		displayName: 'Allow Permission Mode Override',
		name: 'allowPermissionModeOverride',
		type: 'boolean',
		default: false,
		description:
			'Whether to allow the approval response to include a permission mode override for the rest of the session',
		displayOptions: {
			show: {
				backendMode: ['localCli'],
				interactiveApprovals: HITL_ENABLED_VALUES,
			},
		},
	},
	{
		displayName: 'Allowed Override Modes',
		name: 'allowedOverrideModes',
		type: 'multiOptions',
		options: [
			{
				name: 'Accept Edits',
				value: 'acceptEdits',
				description: 'Auto-accept file edits for the rest of the session',
			},
			{
				name: 'Bypass Permissions',
				value: 'bypassPermissions',
				description: 'Bypass all permission checks for the rest of the session',
			},
		],
		// Security default: empty so an approval responder cannot escalate the
		// session permission mode (e.g. to acceptEdits/bypassPermissions) unless
		// the workflow author explicitly opts in. Operators can further constrain
		// the permitted modes via N8N_CLAUDE_POLICY_ALLOWED_PERMISSION_MODES.
		default: [],
		description: 'Which permission mode overrides are allowed in approval responses',
		displayOptions: {
			show: {
				backendMode: ['localCli'],
				interactiveApprovals: HITL_ENABLED_VALUES,
				allowPermissionModeOverride: [true],
			},
		},
	},
	{
		displayName: 'Webhook Authentication',
		name: 'hitlWebhookAuthentication',
		type: 'options',
		options: [
			{
				name: 'None',
				value: 'none',
				description: 'Process signed HITL webhook requests without an additional auth layer',
			},
			{
				name: 'Basic Auth',
				value: 'basicAuth',
				description: 'Prompt browsers for credentials and authenticate with a username/password',
			},
			{
				name: 'Header Auth',
				value: 'headerAuth',
				description: 'Require a static secret header like the built-in n8n Webhook node',
			},
			{
				name: 'JWT Auth',
				value: 'jwtAuth',
				description: 'Require a Bearer JWT and optionally derive identity from a verified claim',
			},
		],
		default: 'none',
		description:
			'Optional extra authentication for the SDK HITL webhook. Header/JWT modes require a client or proxy that can add headers to the approval/question request.',
		displayOptions: {
			// Use `hide` instead of `show` so n8n's auth-field suppression does not
			// incorrectly classify `interactiveApprovals` as an auth dependency and
			// hide the top-level HITL toggle from the NDV.
			hide: {
				interactiveApprovals: [{ _cnd: { not: 'pauseForApproval' } }],
			},
		},
	},
	{
		// Security (V8a): `none` is the out-of-the-box default and is intentionally
		// kept non-breaking, but it leaves the HITL endpoint gated only by the n8n
		// resume token. Surface that posture in the NDV and recommend a second
		// factor; the auth layer also logs a runtime warning on this path.
		displayName: 'Webhook No-Auth Security Notice',
		name: 'hitlWebhookNoAuthNotice',
		type: 'notice',
		default: '',
		description:
			'Webhook Authentication is "None": this approval/question endpoint is '
			+ 'protected only by the n8n resume token in the URL. Anyone who obtains '
			+ 'that URL can answer the request. Enabling Basic/Header/JWT auth as a '
			+ 'second factor is strongly recommended.',
		displayOptions: {
			show: {
				interactiveApprovals: ['pauseForApproval'],
				hitlWebhookAuthentication: ['none'],
			},
		},
	},
	{
		displayName: 'Webhook Auth Browser Notice',
		name: 'hitlWebhookAuthenticationNotice',
		type: 'notice',
		default: '',
		description:
			'Direct browser approval links cannot attach custom headers or Bearer tokens. Use Basic Auth for browser prompts, or put the webhook behind a proxy/confirmation page that injects auth headers.',
		displayOptions: {
			show: {
				interactiveApprovals: HITL_ENABLED_VALUES,
				hitlWebhookAuthentication: ['headerAuth', 'jwtAuth'],
			},
		},
	},
	{
		displayName: 'Responder Identity',
		name: 'hitlWebhookResponderIdentity',
		type: 'options',
		options: [
			{
				name: 'None',
				value: 'none',
				description: 'Do not attach an approver identity to accepted webhook responses',
			},
			{
				name: 'Basic Auth Username',
				value: 'basicUsername',
				description: 'Use the authenticated Basic Auth username as the HITL responder identity',
			},
			{
				name: 'Request Header',
				value: 'headerValue',
				description: 'Read identity from a request header added by a trusted proxy or application',
			},
			{
				name: 'JWT Claim',
				value: 'jwtClaim',
				description: 'Read identity from a verified JWT claim using dot-notation lookup',
			},
		],
		default: 'none',
		description:
			'Optional identity attached to accepted HITL responses. Selecting any mode other than None makes that identity required.',
		displayOptions: {
			show: {
				interactiveApprovals: HITL_ENABLED_VALUES,
				hitlWebhookAuthentication: ['basicAuth', 'headerAuth', 'jwtAuth'],
			},
		},
	},
	{
		displayName: 'Header Identity Trust Notice',
		name: 'hitlWebhookIdentityHeaderNotice',
		type: 'notice',
		default: '',
		description: 'Header-based identity is only trustworthy when a reverse proxy or application strips user-supplied values and injects the identity header itself',
		displayOptions: {
			show: {
				interactiveApprovals: HITL_ENABLED_VALUES,
				hitlWebhookResponderIdentity: ['headerValue'],
			},
		},
	},
	{
		displayName: 'Responder Identity Header',
		name: 'hitlWebhookIdentityHeaderName',
		type: 'string',
		default: 'x-auth-request-email',
		placeholder: 'x-auth-request-email',
		description: 'Header name to read when Responder Identity is set to Request Header',
		displayOptions: {
			show: {
				interactiveApprovals: HITL_ENABLED_VALUES,
				hitlWebhookResponderIdentity: ['headerValue'],
			},
		},
	},
	{
		displayName: 'Responder Identity JWT Claim',
		name: 'hitlWebhookIdentityJwtClaim',
		type: 'string',
		default: 'sub',
		placeholder: 'sub',
		description: 'JWT claim path to read when Responder Identity is set to JWT Claim',
		displayOptions: {
			show: {
				interactiveApprovals: HITL_ENABLED_VALUES,
				hitlWebhookResponderIdentity: ['jwtClaim'],
			},
		},
	},

	// NOTE: Notification channels (Webhook, Slack) are now configured on the
	// dedicated channel nodes (Claude Agent Slack/Telegram/...). The SDK node only does in-stream NDJSON
	// notifications during execution.
];

// ─────────────────────────────────────────────────────────────────────────────
// Config Interface
// ─────────────────────────────────────────────────────────────────────────────

// Parsing/config helpers moved to ./approvalConfig (file-size guard);
// re-exported here so existing importers keep their import path.
export {
	isHitlEnabled,
	parseApprovalConfig,
	resolveHitlPermissionMode,
	toolRequiresApproval,
	type ApprovalConfig,
} from './approvalConfig';
