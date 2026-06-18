import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeConnectionTypes } from 'n8n-workflow';

import { discoverSkillTools, executeSkillTool } from '../../ClaudeAgentSdk/skillToolsMcp';
import { discoverSkills } from '../../ClaudeAgentSdk/skills/discover';
import { ClaudeSkillTool } from '../ClaudeSkillTool.node';

vi.mock('../../ClaudeAgentSdk/skillToolsMcp', () => ({
	discoverSkillTools: vi.fn(),
	executeSkillTool: vi.fn(),
}));

vi.mock('../../ClaudeAgentSdk/skills/discover', () => ({
	discoverSkills: vi.fn(),
}));

function createSupplyContext(params: Record<string, unknown>) {
	return {
		getNodeParameter: vi.fn(
			(name: string, _itemIndex: number, defaultValue: unknown) =>
				(params[name] as unknown) ?? defaultValue,
		),
		getNode: vi.fn().mockReturnValue({ name: 'Claude Skill Tool' }),
		addInputData: vi.fn().mockReturnValue({ index: 0 }),
		addOutputData: vi.fn(),
	};
}

function createLoadOptionsContext(opts: { configured?: string; includeUserSkills?: boolean }) {
	return {
		getNodeParameter: vi.fn((name: string, def?: unknown) => {
			if (name === 'workingDirectory') return opts.configured ?? '';
			if (name === 'includeUserSkills') return opts.includeUserSkills ?? false;
			return def;
		}),
		getNode: vi.fn().mockReturnValue({ name: 'Claude Skill Tool' }),
	};
}

function createRunnerContext(opts: {
	params?: Record<string, unknown>;
	startJob?: ReturnType<typeof vi.fn>;
	omitStartJob?: boolean;
	runnerStatus?: { available: true } | { available: false; reason?: string };
}) {
	const params: Record<string, unknown> = {
		runViaPythonRunner: true,
		pythonCode: 'return {"ok": True}',
		...opts.params,
	};
	const ctx: Record<string, unknown> = {
		getNodeParameter: vi.fn(
			(name: string, _itemIndex: number, defaultValue: unknown) =>
				(params[name] as unknown) ?? defaultValue,
		),
		getNode: vi.fn().mockReturnValue({ id: 'node-1', name: 'Claude Skill Tool' }),
		getWorkflow: vi.fn().mockReturnValue({ id: 'wf-1', name: 'My Workflow' }),
		getMode: vi.fn().mockReturnValue('manual'),
		continueOnFail: vi.fn().mockReturnValue(false),
		addInputData: vi.fn().mockReturnValue({ index: 0 }),
		addOutputData: vi.fn(),
	};
	if (!opts.omitStartJob) {
		ctx.startJob = opts.startJob ?? vi.fn().mockResolvedValue({ ok: true, result: {} });
	}
	if (opts.runnerStatus) {
		ctx.getRunnerStatus = vi.fn().mockReturnValue(opts.runnerStatus);
	}
	return ctx;
}

describe('ClaudeSkillTool node', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns discovered skills in load options', async () => {
		vi.mocked(discoverSkills).mockResolvedValue([
			{
				name: 'my-skill',
				description: 'runs checks',
				source: 'project',
				path: '/workspace/project/.claude/skills/my-skill/SKILL.md',
			},
		]);

		const node = new ClaudeSkillTool();
		const ctx = createLoadOptionsContext({ configured: '/workspace/project', includeUserSkills: true });

		const options = await node.methods.loadOptions.discoverSkills.call(ctx as never);
		expect(options).toEqual([
			{
				name: 'my-skill (project) - runs checks',
				value: 'my-skill',
			},
		]);
		expect(discoverSkills).toHaveBeenCalledWith('/workspace/project', { includeUserSkills: true });
	});

	it('builds an AiTool response that executes a runnable selected skill', async () => {
		vi.mocked(discoverSkillTools).mockResolvedValue([
			{
				kind: 'runnable',
				skillName: 'my-skill',
				toolName: 'skill__my_skill',
				description: 'run my skill',
				skillDir: '/workspace/project/.claude/skills/my-skill',
				command: 'node',
				args: ['run.js'],
				timeoutMs: 120000,
			},
		]);
		vi.mocked(executeSkillTool).mockResolvedValue({
			ok: true,
			mode: 'runnable',
			skill: 'my-skill',
			tool: 'skill__my_skill',
			output: { value: 'done' },
			metadata: {},
		});

		const params: Record<string, unknown> = {
			skillName: 'my-skill',
			workingDirectory: '/workspace/project',
			timeoutMs: 120000,
			toolName: '',
			toolDescription: '',
		};
		const supplyContext = createSupplyContext(params);

		const node = new ClaudeSkillTool();
		const supply = await node.supplyData.call(supplyContext as never, 0);
		const tool = supply.response as {
			name: string;
			invoke: (input: unknown) => Promise<string>;
		};

		expect(tool.name).toBe('skill__my_skill');
		const raw = await tool.invoke({ input: { ticketId: 'T-1' } });
		const parsed = JSON.parse(raw) as { ok: boolean; output: unknown };
		expect(parsed.ok).toBe(true);
		expect(parsed.output).toEqual({ value: 'done' });

		expect(executeSkillTool).toHaveBeenCalledWith(
			expect.objectContaining({
				input: { ticketId: 'T-1' },
				nodeName: 'Claude Skill Tool',
			}),
		);
		expect(supplyContext.addInputData).toHaveBeenCalledWith(
			NodeConnectionTypes.AiTool,
			[[{
				json: {
					query: { input: { ticketId: 'T-1' } },
				},
			}]],
		);
		expect(supplyContext.addOutputData).toHaveBeenCalledWith(
			NodeConnectionTypes.AiTool,
			0,
			[[{
				json: {
					response: expect.objectContaining({ ok: true }),
				},
			}]],
		);
	});

	it('builds an AiTool response that executes a frontmatter-only selected skill', async () => {
		vi.mocked(discoverSkillTools).mockResolvedValue([
			{
				kind: 'instruction',
				skillName: 'read-github',
				toolName: 'skill__read_github',
				description: 'Read GitHub instructions',
				skillDir: '/workspace/project/.claude/skills/read-github',
				skillPath: '/workspace/project/.claude/skills/read-github/SKILL.md',
				frontmatter: { name: 'read-github' },
				instructions: 'Read repository and summarize',
			},
		]);
		vi.mocked(executeSkillTool).mockResolvedValue({
			ok: true,
			mode: 'instruction',
			skill: 'read-github',
			tool: 'skill__read_github',
			output: { instructions: 'Read repository and summarize' },
			metadata: {},
		});

		const params: Record<string, unknown> = {
			skillName: 'read-github',
			workingDirectory: '/workspace/project',
			timeoutMs: 120000,
			toolName: '',
			toolDescription: '',
		};
		const supplyContext = createSupplyContext(params);

		const node = new ClaudeSkillTool();
		const supply = await node.supplyData.call(supplyContext as never, 0);
		const tool = supply.response as {
			name: string;
			invoke: (input: unknown) => Promise<string>;
		};

		const raw = await tool.invoke({ query: 'hello' });
		const parsed = JSON.parse(raw) as { ok: boolean; mode: string };
		expect(parsed.ok).toBe(true);
		expect(parsed.mode).toBe('instruction');
		expect(supplyContext.addInputData).toHaveBeenCalledWith(
			NodeConnectionTypes.AiTool,
			[[{
				json: {
					query: { query: 'hello' },
				},
			}]],
		);
		expect(supplyContext.addOutputData).toHaveBeenCalledWith(
			NodeConnectionTypes.AiTool,
			0,
			[[{
				json: {
					response: expect.objectContaining({ ok: true, mode: 'instruction' }),
				},
			}]],
		);
	});

	it('propagates failed skill execution', async () => {
		vi.mocked(discoverSkillTools).mockResolvedValue([
			{
				kind: 'runnable',
				skillName: 'my-skill',
				toolName: 'skill__my_skill',
				description: 'run my skill',
				skillDir: '/workspace/project/.claude/skills/my-skill',
				command: 'node',
				args: ['run.js'],
				timeoutMs: 120000,
			},
		]);
		vi.mocked(executeSkillTool).mockRejectedValue(new Error('tool execution failed'));

		const params: Record<string, unknown> = {
			skillName: 'my-skill',
			workingDirectory: '/workspace/project',
			timeoutMs: 120000,
			toolName: '',
			toolDescription: '',
		};
		const supplyContext = createSupplyContext(params);

		const node = new ClaudeSkillTool();
		const supply = await node.supplyData.call(supplyContext as never, 0);
		const tool = supply.response as {
			invoke: (input: unknown) => Promise<string>;
		};

		await expect(tool.invoke({ input: { ticketId: 'T-1' } })).rejects.toThrow('tool execution failed');
		expect(supplyContext.addOutputData).not.toHaveBeenCalled();
	});

	it('falls back to the process cwd when the dropdown working directory is empty', async () => {
		// The dropdown's single source of truth is the field; empty => process cwd
		// (mirrors execution), so what is listed is exactly what runs.
		vi.mocked(discoverSkills).mockResolvedValue([]);
		const ctx = createLoadOptionsContext({ configured: '' });

		const node = new ClaudeSkillTool();
		await node.methods.loadOptions.discoverSkills.call(ctx as never);

		expect(discoverSkills).toHaveBeenCalledWith(process.cwd(), { includeUserSkills: false });
	});

	it('uses the typed working directory in the dropdown', async () => {
		vi.mocked(discoverSkills).mockResolvedValue([]);
		const ctx = createLoadOptionsContext({ configured: '/explicit' });

		const node = new ClaudeSkillTool();
		await node.methods.loadOptions.discoverSkills.call(ctx as never);

		expect(discoverSkills).toHaveBeenCalledWith('/explicit', { includeUserSkills: false });
	});

	it('includes user skills in the dropdown when the toggle is on', async () => {
		vi.mocked(discoverSkills).mockResolvedValue([]);
		const ctx = createLoadOptionsContext({ configured: '', includeUserSkills: true });

		const node = new ClaudeSkillTool();
		await node.methods.loadOptions.discoverSkills.call(ctx as never);

		expect(discoverSkills).toHaveBeenCalledWith(process.cwd(), { includeUserSkills: true });
	});

	it('falls back to cwd when the working directory is an unresolvable expression', async () => {
		// An expression like ={{ $('Claude Agent SDK').params.workingDirectory }} can't
		// resolve in the dropdown's isolated workflow and throws — the dropdown must
		// degrade to cwd, not crash. (The expression still resolves at runtime.)
		vi.mocked(discoverSkills).mockResolvedValue([]);
		const ctx = {
			getNodeParameter: vi.fn((name: string, def?: unknown) => {
				if (name === 'workingDirectory') {
					throw new Error("Referenced node doesn't exist: Claude Agent SDK");
				}
				if (name === 'includeUserSkills') return false;
				return def;
			}),
			getNode: vi.fn().mockReturnValue({ name: 'Claude Skill Tool' }),
		};

		const node = new ClaudeSkillTool();
		await expect(
			node.methods.loadOptions.discoverSkills.call(ctx as never),
		).resolves.toBeDefined();

		expect(discoverSkills).toHaveBeenCalledWith(process.cwd(), { includeUserSkills: false });
	});

	it('uses the field (empty => process cwd) at runtime and ignores any connected node', async () => {
		vi.mocked(discoverSkillTools).mockResolvedValue([
			{
				kind: 'instruction',
				skillName: 'my-skill',
				toolName: 'skill__my_skill',
				description: 'Instructions',
				skillDir: `${process.cwd()}/.claude/skills/my-skill`,
				skillPath: `${process.cwd()}/.claude/skills/my-skill/SKILL.md`,
				frontmatter: { name: 'my-skill' },
				instructions: 'do it',
			},
		]);

		const params: Record<string, unknown> = {
			skillName: 'my-skill',
			workingDirectory: '',
			timeoutMs: 120000,
			toolName: '',
			toolDescription: '',
		};
		// A stray `workflow` internal must NOT influence the directory anymore — the
		// field (empty => process cwd) is the single source of truth.
		const supplyContext = createSupplyContext(params) as Record<string, unknown>;
		supplyContext.workflow = {
			getChildNodes: vi.fn().mockReturnValue(['Claude Agent SDK']),
			nodes: { 'Claude Agent SDK': { parameters: { workingDirectory: '/srv/project' } } },
		};

		const node = new ClaudeSkillTool();
		await node.supplyData.call(supplyContext as never, 0);

		expect(discoverSkillTools).toHaveBeenCalledWith(
			expect.objectContaining({ workingDirectory: process.cwd() }),
		);
	});

	it('fails fast when skill is not selected', async () => {
		const params: Record<string, unknown> = {
			skillName: '__none__',
			workingDirectory: '/workspace/project',
			timeoutMs: 120000,
			toolName: '',
			toolDescription: '',
		};
		const supplyContext = createSupplyContext(params);

		const node = new ClaudeSkillTool();
		await expect(node.supplyData.call(supplyContext as never, 0)).rejects.toThrow(
			'No skill selected',
		);
	});
});

describe('ClaudeSkillTool python runner toggle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	async function buildTool(ctx: Record<string, unknown>) {
		const node = new ClaudeSkillTool();
		const supply = await node.supplyData.call(ctx as never, 0);
		return supply.response as {
			name: string;
			description: string;
			invoke: (input: unknown) => Promise<string>;
		};
	}

	it('runs Python on the task runner and returns its result', async () => {
		const startJob = vi.fn().mockResolvedValue({ ok: true, result: { received: { x: 1 } } });
		const ctx = createRunnerContext({
			params: { pythonCode: 'return {"received": _items[0]["json"]}' },
			startJob,
			runnerStatus: { available: true },
		});

		const tool = await buildTool(ctx);
		expect(tool.name).toBe('python_runner');

		const raw = await tool.invoke({ input: { x: 1 } });
		expect(JSON.parse(raw)).toEqual({ received: { x: 1 } });

		expect(startJob).toHaveBeenCalledWith(
			'python',
			expect.objectContaining({
				code: 'return {"received": _items[0]["json"]}',
				nodeMode: 'runOnceForAllItems',
				workflowMode: 'manual',
				continueOnFail: false,
				items: [{ json: { x: 1 } }],
				nodeId: 'node-1',
				nodeName: 'Claude Skill Tool',
				workflowId: 'wf-1',
				workflowName: 'My Workflow',
			}),
			0,
		);
		expect(ctx.addInputData).toHaveBeenCalledWith(NodeConnectionTypes.AiTool, [[{
			json: { query: { input: { x: 1 } } },
		}]]);
		expect(ctx.addOutputData).toHaveBeenCalledWith(NodeConnectionTypes.AiTool, 0, [[{
			json: { response: { received: { x: 1 } } },
		}]]);
	});

	it('uses the custom tool name and description when provided', async () => {
		const ctx = createRunnerContext({
			params: { toolName: 'calc', toolDescription: 'does math', pythonCode: 'return 1' },
			runnerStatus: { available: true },
		});
		const tool = await buildTool(ctx);
		expect(tool.name).toBe('calc');
		expect(tool.description).toBe('does math');
	});

	it('works when getRunnerStatus is not exposed but startJob succeeds', async () => {
		const startJob = vi.fn().mockResolvedValue({ ok: true, result: { ok: true } });
		const ctx = createRunnerContext({ startJob });
		// no runnerStatus → getRunnerStatus is absent on the context (older wiring)
		const tool = await buildTool(ctx);
		const raw = await tool.invoke({});
		expect(JSON.parse(raw)).toEqual({ ok: true });
		expect(startJob).toHaveBeenCalledTimes(1);
	});

	it('fails with a clear error when the runner reports unavailable', async () => {
		const startJob = vi.fn();
		const ctx = createRunnerContext({
			startJob,
			runnerStatus: { available: false, reason: 'runner offline' },
		});
		const tool = await buildTool(ctx);
		await expect(tool.invoke({})).rejects.toThrow(/not available: runner offline/);
		expect(startJob).not.toHaveBeenCalled();
		expect(ctx.addOutputData).not.toHaveBeenCalled();
	});

	it('fails with a clear error when startJob is not available (pre-2.x n8n)', async () => {
		const ctx = createRunnerContext({ omitStartJob: true });
		const tool = await buildTool(ctx);
		await expect(tool.invoke({})).rejects.toThrow(/does not expose startJob/);
		expect(ctx.addOutputData).not.toHaveBeenCalled();
	});

	it('surfaces a sandbox/runtime rejection from the runner', async () => {
		const startJob = vi.fn().mockResolvedValue({
			ok: false,
			error: {
				message:
					"Security violations detected — Import of standard library module 'os' is disallowed.",
			},
		});
		const ctx = createRunnerContext({
			params: { pythonCode: 'import os\nreturn os.getcwd()' },
			startJob,
			runnerStatus: { available: true },
		});
		const tool = await buildTool(ctx);
		await expect(tool.invoke({})).rejects.toThrow(
			/Python runner execution failed: Security violations detected/,
		);
		expect(ctx.addOutputData).not.toHaveBeenCalled();
	});

	it('surfaces a thrown startJob error as a clear runner error', async () => {
		const startJob = vi.fn().mockRejectedValue(new Error('broker connection refused'));
		const ctx = createRunnerContext({ startJob, runnerStatus: { available: true } });
		const tool = await buildTool(ctx);
		await expect(tool.invoke({})).rejects.toThrow(
			/could not execute the code: broker connection refused/,
		);
	});

	it('fails fast when the toggle is on but no Python code is provided', async () => {
		const ctx = createRunnerContext({ params: { pythonCode: '   ' } });
		const node = new ClaudeSkillTool();
		await expect(node.supplyData.call(ctx as never, 0)).rejects.toThrow(/No Python code provided/);
	});
});
