/**
 * In-process skill tools MCP server builder
 *
 * Discovers local skills and exposes:
 * - runnable Python/Node/TypeScript/command entrypoints
 * - frontmatter-only instruction skills
 * as MCP tools with execution metadata.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ApplicationError } from 'n8n-workflow';
import { z } from 'zod';

import { isN8nMcpInProcessEnabled } from './featureFlags';
import { discoverSkills, parseSkillDocument } from './skills/discover';
import type { McpToolResult } from './mcpTypes';
import type { ClaudeAgentSdkModule } from './sdk/types';
import type { McpSdkServerConfig, N8nMcpSettings } from './types';

interface SkillToolManifest {
	name?: string;
	description?: string;
	runtime?: 'python' | 'node' | 'tsx' | 'typescript' | 'command';
	entry?: string;
	command?: string;
	args?: string[];
	timeoutMs?: number;
}

interface RunnableSkillTool {
	kind: 'runnable';
	skillName: string;
	toolName: string;
	description: string;
	skillDir: string;
	manifestPath?: string;
	command: string;
	args: string[];
	timeoutMs: number;
}

interface InstructionSkillTool {
	kind: 'instruction';
	skillName: string;
	toolName: string;
	description: string;
	skillDir: string;
	skillPath: string;
	frontmatter: Record<string, string>;
	instructions: string;
}

type DiscoveredSkillTool = RunnableSkillTool | InstructionSkillTool;

interface RunnableSkillToolExecutionResult {
	ok: boolean;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
}

interface BuildCommandResult {
	command: string;
	args: string[];
}

interface SkillToolExecutionPayload {
	ok: boolean;
	mode: 'runnable' | 'instruction';
	skill: string;
	tool: string;
	output?: unknown;
	stderr?: string;
	metadata: Record<string, unknown>;
}

interface BuildSkillSdkMcpServerArgs {
	settings: N8nMcpSettings;
	existingServerNames: string[];
	sdkModule?: ClaudeAgentSdkModule;
	backendMode: 'localCli' | 'managedAgent';
	workingDirectory: string;
	chatSessionId: string;
	itemIndex: number;
	nodeName: string;
	executionId?: string;
	correlationId?: string;
}

interface BuildSkillSdkMcpServerResult {
	serverName: string;
	serverConfig: McpSdkServerConfig;
	warnings: string[];
	toolCount: number;
}

interface ResolvedCommandSpec {
	runtime: 'python' | 'node' | 'tsx' | 'command';
	entry?: string;
	command?: string;
	args?: string[];
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_BYTES = 1_000_000;
const MAX_INSTRUCTION_OUTPUT_CHARS = 50_000;
const DEFAULT_RUNNER_CANDIDATES: Array<{ entry: string; runtime: 'python' | 'node' | 'tsx' }> = [
	{ entry: 'run.py', runtime: 'python' },
	{ entry: 'run.js', runtime: 'node' },
	{ entry: 'run.ts', runtime: 'tsx' },
	{ entry: 'main.py', runtime: 'python' },
	{ entry: 'main.js', runtime: 'node' },
	{ entry: 'main.ts', runtime: 'tsx' },
];

/**
 * Minimal environment variables forwarded to a spawned skill subprocess.
 *
 * A runnable skill's `command` is discovered from a `TOOL.json`/`tool.json` (or
 * a `run.*` entrypoint) that may live in a repo the agent operates on. Passing
 * `process.env` wholesale would hand that attacker-controllable subprocess the
 * ENTIRE host environment of the n8n process — provider tokens
 * (`ANTHROPIC_API_KEY`), the n8n encryption key, DB passwords, etc. We instead
 * forward only this allowlist of vars a normal CLI
 * tool needs to run, and we explicitly drop dangerous code-injection vars.
 */
const SKILL_TOOL_ENV_ALLOWLIST = [
	'PATH',
	'HOME',
	'SHELL',
	'USER',
	'LOGNAME',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'TERM',
	'TMPDIR',
	'TMP',
	'TEMP',
	// Windows essentials so cmd/python/node can resolve at all.
	'SYSTEMROOT',
	'PATHEXT',
	'COMSPEC',
];

/**
 * Dangerous env vars that enable code execution / loader hijacking and must
 * never reach the subprocess even if they were somehow allowlisted. Mirrors the
 * blocklist in operations/executeTask/config.ts (kept local to avoid importing
 * provider-specific config wiring into the skill MCP module).
 */
const SKILL_TOOL_DANGEROUS_ENV = new Set<string>([
	'LD_PRELOAD',
	'LD_LIBRARY_PATH',
	'DYLD_INSERT_LIBRARIES',
	'DYLD_FORCE_FLAT_NAMESPACE',
	'NODE_OPTIONS',
	'NODE_PATH',
	'BASH_ENV',
	'ENV',
	'PROMPT_COMMAND',
	'PYTHONSTARTUP',
	'PYTHONPATH',
	'PERL5OPT',
	'RUBYOPT',
	'GIT_SSH',
	'GIT_SSH_COMMAND',
]);

/**
 * Build the filtered environment for a spawned skill subprocess. Only
 * allowlisted, non-dangerous host vars are forwarded (see SECURITY note above).
 */
function buildSkillToolEnv(hostEnv: NodeJS.ProcessEnv): Record<string, string> {
	const env: Record<string, string> = {};
	for (const name of SKILL_TOOL_ENV_ALLOWLIST) {
		if (SKILL_TOOL_DANGEROUS_ENV.has(name)) continue;
		const value = hostEnv[name];
		if (typeof value === 'string') {
			env[name] = value;
		}
	}
	return env;
}

function textResult(text: string, isError = false): McpToolResult {
	return {
		content: [{ type: 'text', text }],
		...(isError && { isError: true }),
	};
}

function resolveServerName(baseName: string, existingServerNames: string[]): {
	resolvedName: string;
	warning?: string;
} {
	const trimmed = baseName.trim();
	const preferred = trimmed.length > 0 ? trimmed : 'skills';
	if (!existingServerNames.includes(preferred)) {
		return { resolvedName: preferred };
	}

	let index = 1;
	let candidate = `${preferred}_${index}`;
	while (existingServerNames.includes(candidate)) {
		index += 1;
		candidate = `${preferred}_${index}`;
	}

	return {
		resolvedName: candidate,
		warning: `skill MCP server name "${preferred}" already exists. Using "${candidate}" instead.`,
	};
}

function sanitizeToolName(input: string): string {
	const cleaned = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return cleaned || 'skill';
}

function parseManifest(raw: string, manifestPath: string): SkillToolManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new ApplicationError(
			`Invalid skill tool manifest JSON at ${manifestPath}: ${(error as Error).message}`,
		);
	}

	if (!parsed || typeof parsed !== 'object') {
		throw new ApplicationError(`Skill tool manifest at ${manifestPath} must be a JSON object.`);
	}

	const manifest = parsed as Record<string, unknown>;
	const argsValue = manifest.args;
	if (argsValue !== undefined && !Array.isArray(argsValue)) {
		throw new ApplicationError(`"args" in ${manifestPath} must be an array of strings.`);
	}
	if (Array.isArray(argsValue) && argsValue.some((entry) => typeof entry !== 'string')) {
		throw new ApplicationError(`"args" in ${manifestPath} must contain only strings.`);
	}

	return {
		name: typeof manifest.name === 'string' ? manifest.name : undefined,
		description: typeof manifest.description === 'string' ? manifest.description : undefined,
		runtime:
			manifest.runtime === 'python'
			|| manifest.runtime === 'node'
			|| manifest.runtime === 'tsx'
			|| manifest.runtime === 'typescript'
			|| manifest.runtime === 'command'
				? manifest.runtime
				: undefined,
		entry: typeof manifest.entry === 'string' ? manifest.entry : undefined,
		command: typeof manifest.command === 'string' ? manifest.command : undefined,
		args: argsValue as string[] | undefined,
		timeoutMs: typeof manifest.timeoutMs === 'number' ? manifest.timeoutMs : undefined,
	};
}

function inferRuntimeFromEntry(entry?: string): 'python' | 'node' | 'tsx' | undefined {
	if (!entry) return undefined;
	if (entry.endsWith('.py')) return 'python';
	if (entry.endsWith('.js') || entry.endsWith('.mjs') || entry.endsWith('.cjs')) return 'node';
	if (entry.endsWith('.ts')) return 'tsx';
	return undefined;
}

function resolveCommandSpec(manifest?: SkillToolManifest, fallbackEntry?: string): ResolvedCommandSpec | undefined {
	if (manifest?.runtime === 'command') {
		return {
			runtime: 'command',
			command: manifest.command,
			args: manifest.args ?? [],
		};
	}

	const entry = manifest?.entry ?? fallbackEntry;
	const runtimeFromManifest = manifest?.runtime === 'typescript' ? 'tsx' : manifest?.runtime;
	const runtime = runtimeFromManifest || inferRuntimeFromEntry(entry);
	if (!entry || !runtime) {
		return undefined;
	}

	if (runtime === 'python' || runtime === 'node' || runtime === 'tsx') {
		return {
			runtime,
			entry,
			command: manifest?.command,
			args: manifest?.args ?? [],
		};
	}

	return undefined;
}

function buildCommand(spec: ResolvedCommandSpec): BuildCommandResult | undefined {
	if (spec.runtime === 'command') {
		if (!spec.command || spec.command.trim().length === 0) {
			return undefined;
		}
		return {
			command: spec.command,
			args: spec.args ?? [],
		};
	}

	if (!spec.entry) {
		return undefined;
	}

	if (spec.runtime === 'python') {
		return {
			command: spec.command || 'python3',
			args: [spec.entry, ...(spec.args ?? [])],
		};
	}
	if (spec.runtime === 'node') {
		return {
			command: spec.command || 'node',
			args: [spec.entry, ...(spec.args ?? [])],
		};
	}
	if (spec.runtime === 'tsx') {
		if (spec.command) {
			return {
				command: spec.command,
				args: [spec.entry, ...(spec.args ?? [])],
			};
		}
		return {
			command: 'npx',
			args: ['tsx', spec.entry, ...(spec.args ?? [])],
		};
	}
	return undefined;
}

async function findManifest(skillDir: string): Promise<{ manifestPath: string; manifest: SkillToolManifest } | undefined> {
	const candidates = ['TOOL.json', 'tool.json'];
	for (const candidate of candidates) {
		const manifestPath = path.join(skillDir, candidate);
		try {
			const content = await fs.readFile(manifestPath, 'utf-8');
			return { manifestPath, manifest: parseManifest(content, manifestPath) };
		} catch {
			// no manifest found for this candidate
		}
	}
	return undefined;
}

async function findFallbackEntrypoint(skillDir: string): Promise<{ entry: string; runtime: 'python' | 'node' | 'tsx' } | undefined> {
	for (const candidate of DEFAULT_RUNNER_CANDIDATES) {
		try {
			await fs.access(path.join(skillDir, candidate.entry));
			return candidate;
		} catch {
			// candidate not present
		}
	}
	return undefined;
}

function shouldIncludeSkill(
	settings: N8nMcpSettings,
	skillName: string,
): boolean {
	const mode = settings.skillToolsSelectionMode ?? 'all';
	const selected = new Set((settings.skillTools ?? []).filter(Boolean));
	if (mode === 'all') return true;
	if (mode === 'selected') return selected.has(skillName);
	if (mode === 'except') return !selected.has(skillName);
	return true;
}

function appendCapture(target: string, chunk: Buffer | string): string {
	const str = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
	if (target.length >= MAX_CAPTURE_BYTES) {
		return target;
	}
	const available = MAX_CAPTURE_BYTES - target.length;
	return target + str.slice(0, available);
}

function normalizeToolInput(toolInput: unknown): unknown {
	if (
		toolInput
		&& typeof toolInput === 'object'
		&& 'input' in (toolInput as Record<string, unknown>)
	) {
		return (toolInput as Record<string, unknown>).input;
	}
	return toolInput;
}

function parseStdout(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
}

function toInstructionOutput(instructions: string): {
	instructions: string;
	instructionsLength: number;
	instructionsTruncated: boolean;
} {
	const instructionsLength = instructions.length;
	if (instructionsLength <= MAX_INSTRUCTION_OUTPUT_CHARS) {
		return {
			instructions,
			instructionsLength,
			instructionsTruncated: false,
		};
	}
	return {
		instructions: instructions.slice(0, MAX_INSTRUCTION_OUTPUT_CHARS),
		instructionsLength,
		instructionsTruncated: true,
	};
}

async function executeRunnableSkillTool(args: {
	tool: RunnableSkillTool;
	input: unknown;
	chatSessionId?: string;
	itemIndex: number;
	nodeName: string;
	executionId?: string;
	correlationId?: string;
}): Promise<RunnableSkillToolExecutionResult> {
	const { tool, input, chatSessionId, itemIndex, nodeName, executionId, correlationId } = args;
	const startedAtDate = new Date();
	const startedAt = startedAtDate.toISOString();
	const startedAtMs = Date.now();

	return await new Promise((resolve, reject) => {
		// Forward only a minimal, filtered env — NEVER the full host environment.
		// `tool.command` may come from a TOOL.json discovered in a repo the agent
		// operates on, so the subprocess is attacker-influenced.
		// NOTE: discovery still scans `.claude/skills` under the working directory
		// (see discoverSkills); restricting that surface to a trusted skill source
		// dir is a larger refactor tracked separately — the env filter is the
		// primary containment here.
		const child = spawn(tool.command, tool.args, {
			cwd: tool.skillDir,
			env: buildSkillToolEnv(process.env),
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		let timedOut = false;
		let timeoutHandle: NodeJS.Timeout | undefined;
		let killHandle: NodeJS.Timeout | undefined;

		if (tool.timeoutMs > 0) {
			timeoutHandle = setTimeout(() => {
				timedOut = true;
				child.kill('SIGTERM');
				killHandle = setTimeout(() => child.kill('SIGKILL'), 2_000);
			}, tool.timeoutMs);
		}

		child.stdout.on('data', (chunk) => {
			stdout = appendCapture(stdout, chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderr = appendCapture(stderr, chunk);
		});

		child.on('error', (error) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			if (killHandle) clearTimeout(killHandle);
			reject(error);
		});

		child.on('close', (exitCode, signal) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			if (killHandle) clearTimeout(killHandle);
			const finishedAt = new Date().toISOString();
			const durationMs = Date.now() - startedAtMs;
			resolve({
				ok: exitCode === 0 && !timedOut,
				exitCode,
				signal,
				timedOut,
				stdout,
				stderr,
				startedAt,
				finishedAt,
				durationMs,
			});
		});

		const payload = {
			input: input ?? {},
			context: {
				chatSessionId: chatSessionId || undefined,
				itemIndex,
				nodeName,
				executionId: executionId || undefined,
				correlationId: correlationId || undefined,
				skillName: tool.skillName,
				toolName: tool.toolName,
			},
		};

		child.stdin.write(`${JSON.stringify(payload)}\n`);
		child.stdin.end();
	});
}

export async function executeSkillTool(args: {
	tool: DiscoveredSkillTool;
	input: unknown;
	chatSessionId?: string;
	itemIndex: number;
	nodeName: string;
	executionId?: string;
	correlationId?: string;
	reportedToolName?: string;
}): Promise<SkillToolExecutionPayload> {
	const {
		tool,
		input,
		chatSessionId,
		itemIndex,
		nodeName,
		executionId,
		correlationId,
		reportedToolName,
	} = args;
	const toolName = reportedToolName || tool.toolName;
	const logPrefix = '[Claude Agent SDK][SkillTools]';

	if (tool.kind === 'runnable') {
		console.log(
			`${logPrefix} invoking runnable skill "${tool.skillName}" as "${toolName}" (node=${nodeName}, itemIndex=${itemIndex})`,
		);
		const run = await executeRunnableSkillTool({
			tool,
			input,
			chatSessionId,
			itemIndex,
			nodeName,
			executionId,
			correlationId,
		});
		console.log(
			`${logPrefix} runnable skill "${tool.skillName}" completed (ok=${run.ok}, exitCode=${run.exitCode}, durationMs=${run.durationMs})`,
		);

		return {
			ok: run.ok,
			mode: 'runnable',
			skill: tool.skillName,
			tool: toolName,
			output: parseStdout(run.stdout),
			stderr: run.stderr || undefined,
			metadata: {
				command: tool.command,
				args: tool.args,
				skillDir: tool.skillDir,
				manifestPath: tool.manifestPath,
				timeoutMs: tool.timeoutMs,
				startedAt: run.startedAt,
				finishedAt: run.finishedAt,
				durationMs: run.durationMs,
				exitCode: run.exitCode,
				signal: run.signal || undefined,
				timedOut: run.timedOut,
				chatSessionId: chatSessionId || undefined,
				itemIndex,
				nodeName,
				executionId: executionId || undefined,
				correlationId: correlationId || undefined,
			},
		};
	}

	const instructionOutput = toInstructionOutput(tool.instructions);
	console.log(
		`${logPrefix} invoking instruction skill "${tool.skillName}" as "${toolName}" (node=${nodeName}, itemIndex=${itemIndex}, instructionsLength=${instructionOutput.instructionsLength})`,
	);
	return {
		ok: true,
		mode: 'instruction',
		skill: tool.skillName,
		tool: toolName,
		output: {
			input: input ?? {},
			frontmatter: tool.frontmatter,
			instructions: instructionOutput.instructions,
		},
		metadata: {
			skillDir: tool.skillDir,
			skillPath: tool.skillPath,
			instructionsLength: instructionOutput.instructionsLength,
			instructionsTruncated: instructionOutput.instructionsTruncated,
			chatSessionId: chatSessionId || undefined,
			itemIndex,
			nodeName,
			executionId: executionId || undefined,
			correlationId: correlationId || undefined,
		},
	};
}

function ensureUniqueToolNames(
	tools: DiscoveredSkillTool[],
	warnings: string[],
): DiscoveredSkillTool[] {
	const seen = new Set<string>();
	return tools.map((tool) => {
		let candidate = tool.toolName;
		let counter = 1;
		while (seen.has(candidate)) {
			counter += 1;
			candidate = `${tool.toolName}_${counter}`;
		}
		if (candidate !== tool.toolName) {
			warnings.push(
				`Skill tool name "${tool.toolName}" already exists. Using "${candidate}" instead.`,
			);
		}
		seen.add(candidate);
		return {
			...tool,
			toolName: candidate,
		};
	});
}

export async function discoverSkillTools(args: {
	workingDirectory: string;
	settings: N8nMcpSettings;
	warnings: string[];
}): Promise<DiscoveredSkillTool[]> {
	const { workingDirectory, settings, warnings } = args;
	const discovered = await discoverSkills(workingDirectory || undefined);
	const tools: DiscoveredSkillTool[] = [];

	for (const skill of discovered) {
		if (!shouldIncludeSkill(settings, skill.name)) {
			continue;
		}

		const skillDir = path.dirname(skill.path);
		const manifestInfo = await findManifest(skillDir);
		const fallback = manifestInfo ? undefined : await findFallbackEntrypoint(skillDir);
		const commandSpec = resolveCommandSpec(manifestInfo?.manifest, fallback?.entry);
		const rawName = `skill__${sanitizeToolName(manifestInfo?.manifest.name || skill.name)}`;

		if (commandSpec) {
			const command = buildCommand(commandSpec);
			if (!command) {
				warnings.push(
					`Skipping skill "${skill.name}" due to invalid command/runtime configuration.`,
				);
				continue;
			}

			const timeoutMs = Math.max(
				1_000,
				manifestInfo?.manifest.timeoutMs
				?? settings.skillToolTimeoutMs
				?? DEFAULT_TIMEOUT_MS,
			);

			tools.push({
				kind: 'runnable',
				skillName: skill.name,
				toolName: rawName,
				description:
					manifestInfo?.manifest.description
					|| skill.description
					|| `Execute local skill "${skill.name}"`,
				skillDir,
				manifestPath: manifestInfo?.manifestPath,
				command: command.command,
				args: command.args,
				timeoutMs,
			});
			continue;
		}

		try {
			const skillContent = await fs.readFile(skill.path, 'utf-8');
			const parsed = parseSkillDocument(skillContent);
			tools.push({
				kind: 'instruction',
				skillName: skill.name,
				toolName: rawName,
				description: parsed.description || skill.description || `Use local skill "${skill.name}"`,
				skillDir,
				skillPath: skill.path,
				frontmatter: parsed.frontmatter,
				instructions: parsed.body,
			});
		} catch (error) {
			warnings.push(
				`Skipping skill "${skill.name}" because SKILL.md could not be read/parsed: ${(error as Error).message}`,
			);
		}
	}

	return ensureUniqueToolNames(tools, warnings);
}

export async function discoverRunnableSkillTools(args: {
	workingDirectory: string;
	settings: N8nMcpSettings;
	warnings: string[];
}): Promise<RunnableSkillTool[]> {
	const tools = await discoverSkillTools(args);
	return tools.filter((tool): tool is RunnableSkillTool => tool.kind === 'runnable');
}

export async function buildSkillSdkMcpServer(
	args: BuildSkillSdkMcpServerArgs,
): Promise<BuildSkillSdkMcpServerResult | undefined> {
	const {
		settings,
		existingServerNames,
		sdkModule,
		backendMode,
		workingDirectory,
		chatSessionId,
		itemIndex,
		nodeName,
		executionId,
		correlationId,
	} = args;

	if (!settings.enableSkillTools) {
		return undefined;
	}
	if (!isN8nMcpInProcessEnabled()) {
		throw new ApplicationError(
			'Skill tools (in-process MCP) are disabled by feature flag. ' +
			'Set CLAUDE_AGENT_SDK_ENABLE_N8N_MCP_IN_PROCESS=true to enable in-process tool servers.',
		);
	}
	if (backendMode !== 'localCli') {
		throw new ApplicationError(
			'Skill tools (in-process MCP) are only available with Local CLI execution. ' +
			'Switch "Execution Backend" to "Local CLI", or disable skill tools for remote execution.',
		);
	}
	if (!sdkModule?.tool || !sdkModule?.createSdkMcpServer) {
		throw new ApplicationError(
			'Current @anthropic-ai/claude-agent-sdk version does not expose createSdkMcpServer()/tool(). ' +
			'Upgrade the SDK or disable skill tools.',
		);
	}

	const warnings: string[] = [];
	const discoveredTools = await discoverSkillTools({
		workingDirectory,
		settings,
		warnings,
	});

	if (discoveredTools.length === 0) {
		const detail = warnings.length > 0 ? ` Details: ${warnings.join(' | ')}` : '';
		throw new ApplicationError(
			'Skill tools are enabled but no eligible skills were discovered. ' +
			'Add TOOL.json/tool.json, run.py/run.js/run.ts, or frontmatter instructions in SKILL.md.' +
			detail,
		);
	}

	const { resolvedName, warning } = resolveServerName(
		settings.skillToolsServerName || 'skills',
		existingServerNames,
	);
	if (warning) warnings.push(warning);

	const registeredTools = discoveredTools.map((skillTool) =>
		sdkModule.tool!(
			skillTool.toolName,
			skillTool.description,
			{
				input: z.record(z.string(), z.unknown()).optional(),
			},
			async (toolInput) => {
				try {
					const payload = await executeSkillTool({
						tool: skillTool,
						input: normalizeToolInput(toolInput),
						chatSessionId,
						itemIndex,
						nodeName,
						executionId,
						correlationId,
					});
					return textResult(JSON.stringify(payload, null, 2), !payload.ok);
				} catch (error) {
					return textResult(
						JSON.stringify(
							{
								skill: skillTool.skillName,
								tool: skillTool.toolName,
								ok: false,
								error: (error as Error).message,
							},
							null,
							2,
						),
						true,
					);
				}
			},
		),
	);

	const serverConfig = sdkModule.createSdkMcpServer({
		name: resolvedName,
		tools: registeredTools,
	});

	if (!serverConfig || serverConfig.type !== 'sdk' || !serverConfig.instance) {
		throw new ApplicationError(
			'Failed to build skill tools MCP server. SDK did not return a valid sdk server instance.',
		);
	}

	return {
		serverName: resolvedName,
		serverConfig,
		warnings,
		toolCount: discoveredTools.length,
	};
}
