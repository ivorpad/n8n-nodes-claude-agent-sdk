/**
 * Subagent building and configuration
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import type { SubagentUI, AgentDefinition } from '../../types';

/**
 * Build subagents from UI configuration
 */
export function buildSubagents(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): Record<string, AgentDefinition> {
	const agents: Record<string, AgentDefinition> = {};

	const enableSubagents = execFunctions.getNodeParameter('enableSubagents', itemIndex, false) as boolean;
	
	if (!enableSubagents) {
		return agents;
	}

	const subagentsInput = execFunctions.getNodeParameter('subagents', itemIndex, {}) as {
		agents?: SubagentUI[];
	};

	for (const subagent of subagentsInput.agents || []) {
		if (!subagent.name) continue;

		const agentDef: AgentDefinition = {
			description: subagent.description,
			prompt: subagent.prompt,
		};

		// Handle tool restrictions
		if (subagent.toolRestrictions === 'readonly') {
			agentDef.tools = ['Read', 'Grep', 'Glob'];
		} else if (subagent.toolRestrictions === 'custom' && subagent.tools) {
			agentDef.tools = subagent.tools.split(',').map((t) => t.trim()).filter(Boolean);
		}
		// 'inherit' = no tools field, subagent inherits all from parent

		// Handle model override
		if (subagent.model !== 'inherit') {
			agentDef.model = subagent.model;
		}

		agents[subagent.name] = agentDef;
	}

	return agents;
}

/**
 * Build subagent delegation instructions for the system prompt
 */
export function buildSubagentInstructions(agents: Record<string, AgentDefinition>): string {
	if (Object.keys(agents).length === 0) {
		return '';
	}

	const agentDescriptions = Object.entries(agents)
		.map(([name, def]) => `- **${name}**: ${def.description}`)
		.join('\n');

	return `

## Available Subagents

You have access to specialized subagents via the Task tool. You MUST use the Task tool to delegate to these subagents when appropriate:

${agentDescriptions}

### How to delegate:
Use the Task tool with \`subagent_type\` parameter set to the subagent name. Example:
\`\`\`
Task tool with: subagent_type: "invoicing-expert", prompt: "Help with the user's invoicing question"
\`\`\`

IMPORTANT: When a user's request matches a subagent's description, you MUST delegate to that subagent using the Task tool. Do NOT try to answer yourself.`;
}
