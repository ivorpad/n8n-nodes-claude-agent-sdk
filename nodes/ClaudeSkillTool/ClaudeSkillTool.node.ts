import {
	ApplicationError,
	NodeConnectionTypes,
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import { discoverSkillTools, executeSkillTool } from '../ClaudeAgentSdk/skillToolsMcp';
import { discoverSkills } from '../ClaudeAgentSdk/skills/discover';
import type { N8nMcpSettings } from '../ClaudeAgentSdk/types';

type DynamicToolLike = {
	name: string;
	description: string;
	func: (input: unknown) => Promise<string>;
	invoke: (input: unknown) => Promise<string>;
	call: (input: unknown) => Promise<string>;
};

function parseToolInput(toolInput: unknown): unknown {
	if (toolInput === undefined || toolInput === null) {
		return {};
	}
	if (typeof toolInput === 'string') {
		return { query: toolInput };
	}
	if (typeof toolInput === 'object' && !Array.isArray(toolInput)) {
		const asRecord = toolInput as Record<string, unknown>;
		if (typeof asRecord.rawJson === 'string' && asRecord.rawJson.trim().length > 0) {
			try {
				return JSON.parse(asRecord.rawJson);
			} catch (error) {
				throw new ApplicationError(
					`Invalid rawJson payload: ${(error as Error).message}`,
				);
			}
		}
		if ('input' in asRecord) {
			return asRecord.input;
		}
		return asRecord;
	}
	return toolInput;
}

export class ClaudeSkillTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Claude Skill Tool',
		name: 'claudeSkillTool',
		icon: 'file:claudeSkillTool.svg',
		group: ['output'],
		version: 1,
		description: 'Expose a local Claude skill as an AI tool',
		defaults: {
			name: 'Claude Skill Tool',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools'],
				Tools: ['Recommended Tools'],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiTool],
		outputNames: ['Tool'],
		properties: [
			{
				displayName: 'This node discovers local skills under `.claude/skills` and exposes one as an AiTool.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Working Directory',
				name: 'workingDirectory',
				type: 'string',
				default: '',
				placeholder: "/path/to/project or ={{ $('Claude Agent SDK').params.workingDirectory }}",
				hint: "Tip: use an expression to inherit the Working Directory from the connected Claude Agent SDK node — e.g. ={{ $('Claude Agent SDK').params.workingDirectory }} (resolved at runtime). Empty falls back to the current directory. Enable \"Include User-Level Skills\" below to also list ~/.claude/skills.",
				description:
					"Project directory that contains `.claude/skills`. Use an expression like ={{ $('Claude Agent SDK').params.workingDirectory }} to inherit the connected agent's directory (resolved at runtime); empty falls back to the current directory. Type a literal path to browse a project's skills in the dropdown here.",
			},
			{
				displayName: 'Include User-Level Skills',
				name: 'includeUserSkills',
				type: 'boolean',
				default: false,
				description:
					'Whether to also list skills from your user-level `~/.claude/skills` directory. Off by default, so only the project\'s skills (under the Working Directory) are discovered and exposed.',
			},
			{
				displayName: 'Skill',
				name: 'skillName',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'discoverSkills',
					loadOptionsDependsOn: ['workingDirectory', 'includeUserSkills'],
				},
				default: '',
				noDataExpression: true,
				required: true,
				description: 'Local skill to expose as a callable tool',
			},
			{
				displayName: 'Tool Name',
				name: 'toolName',
				type: 'string',
				default: '',
				placeholder: 'skill__my_tool',
				description: 'Optional override for the exposed tool name',
			},
			{
				displayName: 'Tool Description',
				name: 'toolDescription',
				type: 'string',
				default: '',
				typeOptions: {
					rows: 3,
				},
				description: 'Optional override for tool description shown to the model',
			},
			{
				displayName: 'Timeout (ms)',
				name: 'timeoutMs',
				type: 'number',
				default: 120000,
				typeOptions: {
					minValue: 1000,
				},
				description: 'Maximum execution time for runnable skill process (ignored for instruction-only skills)',
			},
		],
	};

	methods = {
		loadOptions: {
			async discoverSkills(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				// The dropdown runs in n8n's synthetic single-node workflow (no siblings,
				// no connections), so it CANNOT resolve a Working Directory expression that
				// references the connected agent — e.g. ={{ $('Claude Agent SDK')... }} —
				// that node isn't visible here, so resolution throws. Catch it and fall
				// back to the process cwd. The expression still resolves at runtime, where
				// the real connected workflow exists.
				let configured = '';
				try {
					configured = (this.getNodeParameter('workingDirectory', '') as string).trim();
				} catch {
					configured = '';
				}
				const includeUserSkills = this.getNodeParameter('includeUserSkills', false) as boolean;
				const workingDirectory = configured || process.cwd();
				const skills = await discoverSkills(workingDirectory, { includeUserSkills });
				if (skills.length === 0) {
					const guidance = includeUserSkills
						? 'No skills found'
						: `No project skills under ${workingDirectory}/.claude/skills — set a Working Directory or enable "Include User-Level Skills"`;
					return [{ name: guidance, value: '__none__' }];
				}
				return skills.map((skill) => ({
					name: skill.description
						? `${skill.name} (${skill.source}) - ${skill.description}`
						: `${skill.name} (${skill.source})`,
					value: skill.name,
				}));
			},
		},
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const skillName = (this.getNodeParameter('skillName', itemIndex, '') as string).trim();
		if (!skillName || skillName === '__none__') {
			throw new ApplicationError(
				'No skill selected. Choose a skill in the "Skill" field before running.',
			);
		}

		const timeoutMs = Math.max(
			1000,
			Number(this.getNodeParameter('timeoutMs', itemIndex, 120000)) || 120000,
		);
		// Single source of truth: the Working Directory field (empty = the n8n process
		// cwd) drives BOTH the Skill dropdown and execution, so what the dropdown lists
		// is exactly what runs. We deliberately do NOT inherit from the connected agent:
		// n8n runs the dropdown in an isolated synthetic workflow that can't see siblings,
		// so inheriting at runtime only would make the dropdown and execution disagree.
		const configuredWorkingDirectory = (
			this.getNodeParameter('workingDirectory', itemIndex, '') as string
		).trim();
		const workingDirectory = configuredWorkingDirectory || process.cwd();
		const warnings: string[] = [];

		const settings: N8nMcpSettings = {
			skillToolsSelectionMode: 'selected',
			skillTools: [skillName],
			skillToolTimeoutMs: timeoutMs,
		};

		const discoveredTools = await discoverSkillTools({
			workingDirectory,
			settings,
			warnings,
		});
		const selectedSkillTool = discoveredTools.find((tool) => tool.skillName === skillName);
		if (!selectedSkillTool) {
			const details = warnings.length > 0 ? ` Details: ${warnings.join(' | ')}` : '';
			throw new ApplicationError(
				`Skill "${skillName}" was not discovered.${details}`,
			);
		}

		const customToolName = (this.getNodeParameter('toolName', itemIndex, '') as string).trim();
		const customDescription = (
			this.getNodeParameter('toolDescription', itemIndex, '') as string
		).trim();
		const toolName = customToolName || selectedSkillTool.toolName;
		const description = customDescription || selectedSkillTool.description;
		const nodeName = this.getNode().name;

		const run = async (input: unknown): Promise<string> => {
			const { index } = this.addInputData(NodeConnectionTypes.AiTool, [[{
				json: {
					query: input ?? {},
				},
			}]]);

			const parsedInput = parseToolInput(input);
			const payload = await executeSkillTool({
				tool: selectedSkillTool,
				input: parsedInput,
				chatSessionId: undefined,
				itemIndex,
				nodeName,
				reportedToolName: toolName,
			});

			this.addOutputData(NodeConnectionTypes.AiTool, index, [[{
				json: {
					response: payload,
				},
			}]]);

			return JSON.stringify(payload, null, 2);
		};

		const tool: DynamicToolLike = {
			name: toolName,
			description,
			func: run,
			invoke: run,
			call: run,
		};

		return {
			response: tool,
		};
	}
}
