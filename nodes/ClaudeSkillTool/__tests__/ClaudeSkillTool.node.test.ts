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
