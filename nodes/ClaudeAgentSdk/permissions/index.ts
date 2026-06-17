/**
 * Permissions Module
 *
 * Barrel re-exports for the permissions subsystem.
 * Implementation lives in dedicated modules; this file is purely a barrel.
 */

// Types

// Content Filter
export { ENV_FILE_PROTECTION_RULES } from './ContentFilter';

// Tool Permissions
// Hooks Builder
export {
	buildPermissionHooks,
	mergeExecutionHookSources,
	hasAnyPermissionsEnabled,
} from './HooksBuilder';

// Approval Handler
export { ApprovalHandler } from './ApprovalHandler';

// Operator policy (env-driven hard constraints)
export {
	parseOperatorPolicyFromEnv,
	applyOperatorPathPolicy,
	applyOperatorSandboxPolicy,
} from './policy';

// Approval Properties
export {
	parseApprovalConfig,
} from './approvalProperties';

// canUseTool Callback
export { createCanUseToolCallback } from './canUseToolCallback';

// Config Parser
export { parsePermissionsConfig } from './configParser';
