import {
	ApplicationError,
	NodeConnectionTypes,
	type IDataObject,
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

// `getRunnerStatus` is implemented on the runtime SupplyDataContext (inherited
// from BaseExecuteContext) but is deliberately omitted from the
// `ISupplyDataFunctions` type (only `IExecuteFunctions` Picks it). Reach it
// through this narrow shape. A `{ available: false }` result is authoritative;
// `{ available: true }` is NOT a hard guarantee — the core defaults to
// available when a deployment hasn't wired the probe — so the `startJob` call
// is still wrapped in try/catch as the real backstop.
type RunnerStatusProbe = {
	getRunnerStatus?: (
		taskType: string,
	) => { available: true } | { available: false; reason?: string };
};

function extractRunnerErrorMessage(error: unknown): string {
	if (error === undefined || error === null) {
		return 'unknown runner error';
	}
	if (typeof error === 'string') {
		return error;
	}
	if (typeof error === 'object') {
		const record = error as Record<string, unknown>;
		if (typeof record.message === 'string' && record.message.length > 0) {
			return record.message;
		}
		if (typeof record.description === 'string' && record.description.length > 0) {
			return record.description;
		}
	}
	return JSON.stringify(error);
}

/**
 * Build a tool that runs author-supplied Python on n8n's native Python task
 * runner (sandboxed: no network, allowlisted imports, no filesystem) instead of
 * spawning a local skill. The runner is unavailable on pre-2.x n8n and when the
 * task runner is not running; both are detected at call time and surfaced as a
 * clear error rather than silently falling back to unsandboxed execution.
 */
function buildPythonRunnerTool(ctx: ISupplyDataFunctions, itemIndex: number): SupplyData {
	const pythonCode = (ctx.getNodeParameter('pythonCode', itemIndex, '') as string).trim();
	if (!pythonCode) {
		throw new ApplicationError(
			'No Python code provided. Add code in the "Python Code" field, or turn off "Run via Python Runner".',
		);
	}

	const toolName =
		(ctx.getNodeParameter('toolName', itemIndex, '') as string).trim() || 'python_runner';
	const description =
		(ctx.getNodeParameter('toolDescription', itemIndex, '') as string).trim() ||
		'Run sandboxed Python on the n8n task runner. Pass tool input as JSON; it is available to the code as _items[0]["json"]. Returns the code\'s return value.';
	const runnerUnavailableHint =
		' Turn off "Run via Python Runner" on the Claude Skill Tool node, or start the n8n Python task runner.';

	const run = async (input: unknown): Promise<string> => {
		const { index } = ctx.addInputData(NodeConnectionTypes.AiTool, [[{
			json: {
				query: input ?? {},
			},
		}]]);

		// n8n-version gate: startJob only exists on v2.x runner-capable contexts.
		if (typeof ctx.startJob !== 'function') {
			throw new ApplicationError(
				`The n8n Python task runner is not available: this n8n version does not expose startJob.${runnerUnavailableHint}`,
			);
		}

		// Pre-flight availability probe (clean early signal when the runner is down).
		const status = (ctx as unknown as RunnerStatusProbe).getRunnerStatus?.('python');
		if (status && !status.available) {
			const reason = status.reason ? `: ${status.reason}` : '.';
			throw new ApplicationError(
				`The n8n Python task runner is not available${reason}${runnerUnavailableHint}`,
			);
		}

		const parsedInput = parseToolInput(input);
		const inputJson: IDataObject =
			parsedInput && typeof parsedInput === 'object' && !Array.isArray(parsedInput)
				? (parsedInput as IDataObject)
				: { input: parsedInput as IDataObject[string] };

		const node = ctx.getNode();
		const workflow = ctx.getWorkflow();
		// Mirror the canonical PythonTaskRunnerSandbox taskSettings. continueOnFail
		// is forced false: we want a hard, explicit error when the runner rejects
		// or the code fails, never a silently swallowed result.
		const taskSettings: Record<string, unknown> = {
			code: pythonCode,
			nodeMode: 'runOnceForAllItems',
			workflowMode: ctx.getMode(),
			continueOnFail: false,
			items: [{ json: inputJson }],
			nodeId: node.id,
			nodeName: node.name,
			workflowId: workflow.id,
			workflowName: workflow.name,
		};

		let result: unknown;
		try {
			const executionResult = await ctx.startJob<unknown>('python', taskSettings, itemIndex);
			if (!executionResult.ok) {
				const detail = extractRunnerErrorMessage(
					'error' in executionResult ? executionResult.error : undefined,
				);
				throw new ApplicationError(`Python runner execution failed: ${detail}`);
			}
			result = executionResult.result;
		} catch (error) {
			if (error instanceof ApplicationError) {
				throw error;
			}
			throw new ApplicationError(
				`The n8n Python task runner could not execute the code: ${(error as Error).message}.${runnerUnavailableHint}`,
			);
		}

		ctx.addOutputData(NodeConnectionTypes.AiTool, index, [[{
			json: {
				response: result as IDataObject[string],
			},
		}]]);

		return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
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
				displayOptions: { hide: { runViaPythonRunner: [true] } },
			},
			{
				displayName: 'Run via Python Runner',
				name: 'runViaPythonRunner',
				type: 'boolean',
				default: false,
				description:
					"Whether to expose sandboxed Python code — run on n8n's native Python task runner — as the tool, instead of a local skill. The runner sandboxes execution (no network, allowlisted imports, no filesystem). Requires n8n v2.x with the Python task runner enabled; if it is unavailable when the tool is called, the tool fails with a clear error (it never silently falls back to unsandboxed execution).",
			},
			{
				displayName:
					'Runs author-supplied Python on the sandboxed n8n task runner. Read the tool input from `_items` (the input is `_items[0]["json"]`) and `return` a JSON-serialisable value. No `_` helpers except `_items`; no network; imports limited to the runner allowlist.',
				name: 'pythonRunnerNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { runViaPythonRunner: [true] } },
			},
			{
				displayName: 'Python Code',
				name: 'pythonCode',
				type: 'string',
				typeOptions: {
					editor: 'codeNodeEditor',
					editorLanguage: 'python',
					rows: 10,
				},
				default: '',
				noDataExpression: true,
				displayOptions: { show: { runViaPythonRunner: [true] } },
				placeholder: 'payload = _items[0]["json"]\nreturn {"received": payload}',
				description:
					'Python to run on the n8n task runner when the tool is called. Read the tool input from the `_items` variable and `return` a JSON-serialisable value. Use `print()` for debug output (visible in the browser console).',
			},
			{
				displayName: 'Working Directory',
				name: 'workingDirectory',
				type: 'string',
				default: '',
				displayOptions: { hide: { runViaPythonRunner: [true] } },
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
				displayOptions: { hide: { runViaPythonRunner: [true] } },
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
				displayOptions: { hide: { runViaPythonRunner: [true] } },
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
				displayOptions: { hide: { runViaPythonRunner: [true] } },
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
		const runViaPythonRunner = this.getNodeParameter(
			'runViaPythonRunner',
			itemIndex,
			false,
		) as boolean;
		if (runViaPythonRunner) {
			return buildPythonRunnerTool(this, itemIndex);
		}

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
