import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { ClaudeAgentSdkModule } from '../sdk/types';
import {
	buildSkillSdkMcpServer,
	discoverRunnableSkillTools,
	discoverSkillTools,
	executeSkillTool,
} from '../skillToolsMcp';

function createSkillDir(baseDir: string, skillDirName: string, skillName: string, description = ''): string {
	const skillDir = path.join(baseDir, '.claude', 'skills', skillDirName);
	fs.mkdirSync(skillDir, { recursive: true });
	const skillMd = [
		'---',
		`name: ${skillName}`,
		`description: ${description}`,
		'---',
		'',
		`# ${skillName}`,
	].join('\n');
	fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');
	return skillDir;
}

function createSdkStub(): ClaudeAgentSdkModule {
	return {
		query: vi.fn() as unknown as ClaudeAgentSdkModule['query'],
		tool: vi.fn((name: string, description: string, schema: unknown, handler: unknown) => ({
			name,
			description,
			schema,
			handler,
		})) as unknown as NonNullable<ClaudeAgentSdkModule['tool']>,
		createSdkMcpServer: vi.fn((config: { name: string; tools: unknown[] }) => ({
			type: 'sdk',
			name: config.name,
			instance: { tools: config.tools },
		})) as unknown as NonNullable<ClaudeAgentSdkModule['createSdkMcpServer']>,
	};
}

describe('skillToolsMcp', () => {
	let tempDir: string;
	let previousFeatureFlag: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-skill-tools-'));
		previousFeatureFlag = process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;
		process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = 'true';
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		if (previousFeatureFlag === undefined) {
			delete process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS;
		} else {
			process.env.CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS = previousFeatureFlag;
		}
	});

	it('discovers runnable skill tools from manifest and fallback runner files', async () => {
		const pythonSkillName = 'skill-python-test';
		const jsSkillName = 'skill-js-test';

		const pythonSkillDir = createSkillDir(tempDir, 'python-skill', pythonSkillName, 'python runner');
		fs.writeFileSync(
			path.join(pythonSkillDir, 'TOOL.json'),
			JSON.stringify({
				description: 'Run python skill',
				runtime: 'python',
				entry: 'runner.py',
			}),
			'utf-8',
		);
		fs.writeFileSync(path.join(pythonSkillDir, 'runner.py'), 'print("{}")\n', 'utf-8');

		const jsSkillDir = createSkillDir(tempDir, 'js-skill', jsSkillName, 'js runner');
		fs.writeFileSync(path.join(jsSkillDir, 'run.js'), 'process.stdout.write("{}\\n");\n', 'utf-8');

		const warnings: string[] = [];
		const tools = await discoverRunnableSkillTools({
			workingDirectory: tempDir,
			settings: {
				skillToolsSelectionMode: 'selected',
				skillTools: [pythonSkillName, jsSkillName],
				skillToolTimeoutMs: 5000,
			},
			warnings,
		});

		expect(warnings).toEqual([]);
		expect(tools).toHaveLength(2);
		expect(tools.map((tool) => tool.toolName)).toEqual(
			expect.arrayContaining(['skill__skill_python_test', 'skill__skill_js_test']),
		);
	});

	it('discovers frontmatter-only skills as instruction tools', async () => {
		const frontmatterSkillName = 'read-github';
		const skillDir = createSkillDir(
			tempDir,
			'read-github',
			frontmatterSkillName,
			'Read GitHub information from input',
		);
		fs.writeFileSync(
			path.join(skillDir, 'SKILL.md'),
			[
				'---',
				`name: ${frontmatterSkillName}`,
				'description: Read GitHub information from input',
				'---',
				'',
				'# Goal',
				'Use repository input and return next actions.',
			].join('\n'),
			'utf-8',
		);

		const warnings: string[] = [];
		const tools = await discoverSkillTools({
			workingDirectory: tempDir,
			settings: {
				skillToolsSelectionMode: 'selected',
				skillTools: [frontmatterSkillName],
			},
			warnings,
		});

		expect(warnings).toEqual([]);
		expect(tools).toHaveLength(1);
		expect(tools[0]?.kind).toBe('instruction');
		expect(tools[0]?.toolName).toBe('skill__read_github');
	});

	it('returns instruction payload for frontmatter-only skill execution', async () => {
		const instructionSkill = {
			kind: 'instruction' as const,
			skillName: 'read-github',
			toolName: 'skill__read_github',
			description: 'Read GitHub information',
			skillDir: '/tmp/skills/read-github',
			skillPath: '/tmp/skills/read-github/SKILL.md',
			frontmatter: { name: 'read-github' },
			instructions: 'Analyze repository changes and summarize.',
		};

		const payload = await executeSkillTool({
			tool: instructionSkill,
			input: { repo: 'acme/demo' },
			itemIndex: 1,
			nodeName: 'Claude Skill Tool',
		});

		expect(payload.ok).toBe(true);
		expect(payload.mode).toBe('instruction');
		expect(payload.output).toEqual({
			input: { repo: 'acme/demo' },
			frontmatter: { name: 'read-github' },
			instructions: 'Analyze repository changes and summarize.',
		});
	});

	it('rejects skill tools in remote backend', async () => {
		await expect(
			buildSkillSdkMcpServer({
				settings: { enableSkillTools: true },
				existingServerNames: [],
				sdkModule: createSdkStub(),
				backendMode: 'managedAgent',
				workingDirectory: tempDir,
				chatSessionId: 'chat-1',
				itemIndex: 0,
				nodeName: 'Claude Agent SDK',
			}),
		).rejects.toThrow('only available with Local CLI execution');
	});

	it('builds MCP server with discovered skill tools on local backend', async () => {
		const skillName = 'skill-build-test';
		const skillDir = createSkillDir(tempDir, 'build-skill', skillName, 'build runner');
		fs.writeFileSync(path.join(skillDir, 'run.js'), 'process.stdout.write("{\\"ok\\":true}\\n");\n', 'utf-8');

		const sdkModule = createSdkStub();
		const result = await buildSkillSdkMcpServer({
			settings: {
				enableSkillTools: true,
				skillToolsSelectionMode: 'selected',
				skillTools: [skillName],
				skillToolsServerName: 'skills',
			},
			existingServerNames: [],
			sdkModule,
			backendMode: 'localCli',
			workingDirectory: tempDir,
			chatSessionId: 'chat-1',
			itemIndex: 0,
			nodeName: 'Claude Agent SDK',
			executionId: 'exec-1',
			correlationId: 'corr-1',
		});

		expect(result).toBeDefined();
		expect(result?.serverName).toBe('skills');
		expect(result?.toolCount).toBe(1);
	});

	it('builds MCP server for frontmatter-only skill on local backend', async () => {
		const skillName = 'skill-frontmatter';
		createSkillDir(tempDir, 'skill-frontmatter', skillName, 'instruction only');

		const sdkModule = createSdkStub();
		const result = await buildSkillSdkMcpServer({
			settings: {
				enableSkillTools: true,
				skillToolsSelectionMode: 'selected',
				skillTools: [skillName],
				skillToolsServerName: 'skills',
			},
			existingServerNames: [],
			sdkModule,
			backendMode: 'localCli',
			workingDirectory: tempDir,
			chatSessionId: 'chat-1',
			itemIndex: 0,
			nodeName: 'Claude Agent SDK',
			executionId: 'exec-1',
			correlationId: 'corr-1',
		});

		expect(result).toBeDefined();
		expect(result?.toolCount).toBe(1);
	});

	// ───────────────────────────────────────────────────────────────────────
	// V11c: skill subprocess must NOT inherit the full host environment.
	// A repo the agent operates on can drop a TOOL.json that runs arbitrary
	// code; that child must not see host secrets (n8n encryption key, DB
	// passwords, provider tokens, etc.). It should get a minimal filtered env.
	// ───────────────────────────────────────────────────────────────────────

	it('does not expose the full host environment to the spawned skill subprocess (V11c)', async () => {
		const sentinel = `SECRET_SENTINEL_${Date.now()}`;
		const previous = process.env[sentinel];
		process.env[sentinel] = 'top-secret-host-value';

		try {
			const skillName = 'skill-env-leak';
			const skillDir = createSkillDir(tempDir, 'env-skill', skillName, 'echo env');
			// run.js prints the child's environment as JSON so we can inspect it.
			fs.writeFileSync(
				path.join(skillDir, 'run.js'),
				'process.stdout.write(JSON.stringify({ env: process.env }));\n',
				'utf-8',
			);

			const warnings: string[] = [];
			const tools = await discoverRunnableSkillTools({
				workingDirectory: tempDir,
				settings: { skillToolsSelectionMode: 'selected', skillTools: [skillName] },
				warnings,
			});
			expect(tools).toHaveLength(1);

			const payload = await executeSkillTool({
				tool: tools[0],
				input: {},
				itemIndex: 0,
				nodeName: 'Claude Skill Tool',
			});

			expect(payload.ok).toBe(true);
			const output = payload.output;
			expect(isEnvOutput(output)).toBe(true);
			if (!isEnvOutput(output)) throw new Error('unexpected skill output shape');
			const childEnv = output.env;

			// The host sentinel must NOT be visible to the skill subprocess.
			expect(childEnv[sentinel]).toBeUndefined();
			// Essential vars are still provided so tools can actually run.
			expect(typeof childEnv.PATH).toBe('string');
		} finally {
			if (previous === undefined) {
				delete process.env[sentinel];
			} else {
				process.env[sentinel] = previous;
			}
		}
	});

	it('drops dangerous environment variables from the spawned skill subprocess (V11c)', async () => {
		const previousNodeOptions = process.env.NODE_OPTIONS;
		// A benign-but-blocklisted value: presence in the child would prove leakage.
		process.env.NODE_OPTIONS = '--title=leaked';

		try {
			const skillName = 'skill-dangerous-env';
			const skillDir = createSkillDir(tempDir, 'dangerous-env-skill', skillName, 'echo env');
			fs.writeFileSync(
				path.join(skillDir, 'run.js'),
				'process.stdout.write(JSON.stringify({ env: process.env }));\n',
				'utf-8',
			);

			const warnings: string[] = [];
			const tools = await discoverRunnableSkillTools({
				workingDirectory: tempDir,
				settings: { skillToolsSelectionMode: 'selected', skillTools: [skillName] },
				warnings,
			});

			const payload = await executeSkillTool({
				tool: tools[0],
				input: {},
				itemIndex: 0,
				nodeName: 'Claude Skill Tool',
			});

			const output = payload.output;
			if (!isEnvOutput(output)) throw new Error('unexpected skill output shape');
			expect(output.env.NODE_OPTIONS).toBeUndefined();
		} finally {
			if (previousNodeOptions === undefined) {
				delete process.env.NODE_OPTIONS;
			} else {
				process.env.NODE_OPTIONS = previousNodeOptions;
			}
		}
	});
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isEnvOutput(value: unknown): value is { env: Record<string, string | undefined> } {
	return isRecord(value) && isRecord(value.env);
}
