/**
 * Node Properties - Combined export
 *
 * This module exports all node property definitions organized by category.
 */

import type { INodeProperties } from 'n8n-workflow';

import { authenticationProperty } from './authentication';
import { localCliOnly, gateLocalCli, operationOnly } from './backendModeHelper';
import { managedAgentProperties } from './managedAgent';
import { managedAgentLifecycleProperties } from './managedAgentLifecycle';
import { managedAgentBinaryOutputsProperties } from './managedAgentBinaryOutputs';
import { executeTaskCoreProperties, executionSettingsProperty } from './executeTask';
import { openrouterModelProperties } from './openrouterModels';
import { alibabaCodingPlanModelProperties } from './alibabaCodingPlanModels';
import { ollamaModelProperty } from './ollamaModels';
import { binaryInputsProperties } from './binaryInputs';
import { mcpServersProperties } from './mcpServers';
import { n8nMcpProperties } from './n8nMcp';
import { subagentsProperties } from './subagents';
import { pluginsProperties } from './plugins';
import { structuredOutputProperties } from './structuredOutput';
import { additionalOptionsProperty, claudeCodePresetProperties } from './additionalOptions';
import { hookHandlersProperties } from './hookHandlers';
import { approvalProperties } from '../permissions/approvalProperties';

/**
 * All node properties combined in the correct order.
 * Import permissions properties separately from ./permissions
 */
export const nodeProperties: INodeProperties[] = [
	// Authentication method selection
	authenticationProperty,

	// Execute Task operation (core fields)
	...executeTaskCoreProperties,

	// Managed Agent settings (only visible when backendMode = managedAgent)
	...managedAgentProperties,
	...managedAgentBinaryOutputsProperties,
	...managedAgentLifecycleProperties,

	// HITL configuration (top-level switch + HITL-specific settings)
	...operationOnly(approvalProperties, ['executeTask']),

	// Execution settings (session/error/runtime behavior)
	executionSettingsProperty,

	// Claude Code preset controls — local CLI only
	...localCliOnly(claudeCodePresetProperties),

	// Additional options — local CLI only (provider/env/prompt context are
	// Claude-Code-specific; managed agents get their system prompt from the
	// agent definition)
	gateLocalCli(additionalOptionsProperty),

	// OpenRouter / Alibaba / Ollama model overrides — alternative providers
	// only work for localCli (managed agents are Anthropic-hosted)
	...localCliOnly(openrouterModelProperties),
	...localCliOnly(alibabaCodingPlanModelProperties),
	gateLocalCli(ollamaModelProperty),

	// Structured Output — no managed equivalent API
	...localCliOnly(structuredOutputProperties),

	// Binary Inputs — directory semantics are local-only
	...localCliOnly(binaryInputsProperties),

	// MCP Servers — managed MCP has a different shape (URL + vault_ids)
	...localCliOnly(mcpServersProperties),

	// In-process n8n MCP — no managed equivalent
	...localCliOnly(n8nMcpProperties),

	// Subagents — managed uses `callable_agents` preview, not the local Task tool
	...localCliOnly(subagentsProperties),

	// Plugins — Claude Code plugins only
	...localCliOnly(pluginsProperties),

	// Hook Handlers — managed already exposes event streams; no hook abstraction
	...localCliOnly(hookHandlersProperties),

	// Security/Permissions (bottom section)
	// Import permissions properties separately and add after this using:
	// ...permissionsProperties
];
