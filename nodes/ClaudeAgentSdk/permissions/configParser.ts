/**
 * Permissions Config Parser
 *
 * Parses permission configuration from n8n node parameters into a
 * PermissionsConfig object consumed by the permission evaluation chain.
 */

import { ApplicationError } from 'n8n-workflow';
import * as path from 'node:path';

import type { IExecuteFunctions } from 'n8n-workflow';
import type {
	PermissionsConfig,
	PathSandboxConfig,
	ContentFilterConfig,
	ContentBlockRule,
	ToolPermissionRule,
	AgtGovernanceConfig,
	AgtRuleRow,
	AgtConflictStrategy,
	AgtFilterValue,
} from './types';
import { ENV_FILE_PROTECTION_RULES } from './ContentFilter';
import { debugWarn } from '../diagnostics';

/**
 * Parse permissions configuration from n8n node parameters
 * Security options are now nested under 'securityOptions' collection
 * @param additionalDirectories - Additional directories to allow (from top-level field, shared with SDK)
 * @param workingDirectory - Resolved working directory for 'workingDirectory' base path mode
 */
export function parsePermissionsConfig(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	additionalDirectories?: string[],
	workingDirectory?: string,
): PermissionsConfig {
	const config: PermissionsConfig = {};

	// Get the security options collection
	const securityOptions = execFunctions.getNodeParameter('securityOptions', itemIndex, {}) as {
		pathSandbox?: {
			settings?: {
				enabled?: boolean;
				basePath?: string;
				affectedTools?: string[];
			};
		};
		contentFilter?: {
			settings?: {
				enabled?: boolean;
				presets?: string[];
				customRules?: string;
			};
		};
		toolPermissions?: {
			settings?: {
				enabled?: boolean;
				defaultDecision?: 'allow' | 'deny';
				askFallback?: 'allow' | 'deny';
				rules?: string;
			};
		};
		auditLogging?: {
			settings?: {
				enabled?: boolean;
				logInputs?: boolean;
				logOutputs?: boolean;
				redactPatterns?: string;
				maxEntries?: number;
			};
		};
		agtGovernance?: {
			settings?: {
				enabled?: boolean;
				defaultAction?: string;
				conflictStrategy?: string;
				agentDid?: string;
				rules?: {
					values?: unknown[];
				};
			};
		};
	};

	// Parse Path Sandbox
	const pathSandboxParam = securityOptions.pathSandbox;
	if (pathSandboxParam?.settings?.enabled) {
		const basePathMode = (pathSandboxParam.settings as Record<string, unknown>).basePathMode as string | undefined;
		let resolvedBasePath: string;

		if (basePathMode === 'custom') {
			const rawBasePath = (pathSandboxParam.settings.basePath || '').trim();
			if (!rawBasePath) {
				throw new ApplicationError(
					'Path sandbox is enabled with Custom Path mode but no base path was provided. Set a sandbox base path or switch to Working Directory mode.',
				);
			}
			if (!path.isAbsolute(rawBasePath)) {
				throw new ApplicationError('Path sandbox base path must be an absolute path.');
			}
			resolvedBasePath = path.normalize(rawBasePath);
		} else {
			// Default: use working directory
			if (!workingDirectory) {
				throw new ApplicationError(
					'Path sandbox is enabled with Working Directory mode but no working directory is set. Set a Working Directory on the node or switch to Custom Path mode.',
				);
			}
			resolvedBasePath = path.normalize(workingDirectory);
		}

		config.pathSandbox = {
			enabled: true,
			basePath: resolvedBasePath,
			affectedTools: (pathSandboxParam.settings.affectedTools || []) as PathSandboxConfig['affectedTools'],
			// Use additionalDirectories from top-level field (shared with SDK)
			allowedPaths: additionalDirectories?.length ? additionalDirectories : undefined,
		};
	}

	// Parse Content Filter
	const contentFilterParam = securityOptions.contentFilter;
	if (contentFilterParam?.settings?.enabled) {
		let customRules: ContentBlockRule[] = [];
		if (contentFilterParam.settings.customRules) {
			try {
				customRules = JSON.parse(contentFilterParam.settings.customRules);
			} catch {
				debugWarn('Failed to parse custom content filter rules');
			}
		}

		config.contentFilter = {
			enabled: true,
			rules: customRules,
			presets: (contentFilterParam.settings.presets || []) as ContentFilterConfig['presets'],
		};
	}

	// Parse Tool Permissions
	const toolPermissionsParam = securityOptions.toolPermissions;
	if (toolPermissionsParam?.settings?.enabled) {
		let rules: ToolPermissionRule[] = [];
		if (toolPermissionsParam.settings.rules) {
			try {
				rules = JSON.parse(toolPermissionsParam.settings.rules);
			} catch {
				debugWarn('Failed to parse tool permission rules');
			}
		}

		config.toolPermissions = {
			enabled: true,
			defaultDecision: toolPermissionsParam.settings.defaultDecision || 'allow',
			askFallback: toolPermissionsParam.settings.askFallback || 'deny',
			rules,
		};
	}

	// Parse Audit Logging
	const auditLoggingParam = securityOptions.auditLogging;
	if (auditLoggingParam?.settings?.enabled) {
		const redactPatternsStr = auditLoggingParam.settings.redactPatterns || '';
		config.auditLogger = {
			enabled: true,
			logInputs: auditLoggingParam.settings.logInputs !== false,
			logOutputs: auditLoggingParam.settings.logOutputs === true,
			redactPatterns: redactPatternsStr
				? redactPatternsStr.split(',').map((p) => p.trim()).filter(Boolean)
				: undefined,
			maxEntries: auditLoggingParam.settings.maxEntries || 1000,
		};
	}

	// Parse AGT Governance
	const agtGovernanceParam = securityOptions.agtGovernance;
	if (agtGovernanceParam?.settings?.enabled) {
		const rawRules = agtGovernanceParam.settings.rules?.values;
		const rows: AgtRuleRow[] = [];

		if (Array.isArray(rawRules)) {
			for (let i = 0; i < rawRules.length; i++) {
				const raw = rawRules[i] as Record<string, unknown>;
				const tools = (raw.tools ?? []) as string[];
				if (tools.length === 0) {
					throw new ApplicationError(
						`AGT rule ${i + 1} has no tools selected. Each rule must apply to at least one tool.`,
					);
				}

				const rawApprovers = ((raw.approvers ?? '') as string).trim();
				const approvers = rawApprovers
					? rawApprovers.split(',').map((a) => a.trim()).filter(Boolean)
					: undefined;

				const rawLimit = ((raw.limit ?? '') as string).trim() || undefined;
				const rawName = ((raw.name ?? '') as string).trim();
				const rawConditions = raw.conditions as AgtFilterValue | undefined;
				const hasConditions = rawConditions
					&& typeof rawConditions === 'object'
					&& Array.isArray((rawConditions as Record<string, unknown>).conditions)
					&& ((rawConditions as Record<string, unknown>).conditions as unknown[]).length > 0;

				rows.push({
					name: rawName || `rule-${i + 1}`,
					tools,
					decision: (raw.decision as AgtRuleRow['decision']) || 'deny',
					conditions: hasConditions ? rawConditions : undefined,
					priority: typeof raw.priority === 'number' ? raw.priority : 100,
					approvers: approvers && approvers.length > 0 ? approvers : undefined,
					limit: rawLimit,
				});
			}
		}

		const rawAgentDid = ((agtGovernanceParam.settings.agentDid ?? '') as string).trim() || undefined;

		config.agtGovernance = {
			enabled: true,
			defaultAction: (agtGovernanceParam.settings.defaultAction as AgtGovernanceConfig['defaultAction']) || 'deny',
			conflictStrategy: (agtGovernanceParam.settings.conflictStrategy as AgtConflictStrategy) || 'priorityFirstMatch',
			agentDid: rawAgentDid,
			rules: rows,
		};
	}

	// Parse Block Env Files (top-level option, enabled by default)
	const blockEnvFiles = execFunctions.getNodeParameter('blockEnvFiles', itemIndex, true) as boolean;
	if (blockEnvFiles) {
		// Inject env protection rules into content filter
		if (config.contentFilter) {
			// Prepend env rules for higher priority
			config.contentFilter.rules = [...ENV_FILE_PROTECTION_RULES, ...config.contentFilter.rules];
			config.contentFilter.enabled = true;
		} else {
			// Create content filter with env protection rules
			config.contentFilter = {
				enabled: true,
				rules: ENV_FILE_PROTECTION_RULES,
			};
		}
	}

	return config;
}
