import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, resolve } from 'node:path';

const CLAUDE_AGENT_SDK_PACKAGE_NAME = '@anthropic-ai/claude-agent-sdk';
const CLAUDE_CODE_PACKAGE_NAME = '@anthropic-ai/claude-code';
const ANTHROPIC_SCOPE = '@anthropic-ai/';

interface ClaudeCodePackageJson {
	bin?: string | Record<string, string>;
}

interface NativeExecutableCandidate {
	packageName: string;
	executableName: string;
}

function readPackageJson(packageJsonPath: string): ClaudeCodePackageJson | undefined {
	try {
		return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as ClaudeCodePackageJson;
	} catch {
		return undefined;
	}
}

function resolveBinEntry(bin: ClaudeCodePackageJson['bin']): string | undefined {
	if (typeof bin === 'string') return bin;
	return bin?.claude;
}

export function resolveClaudeCodeExecutableFromPackageJson(
	packageJsonPath: string,
): string | undefined {
	const packageJson = readPackageJson(packageJsonPath);
	const binEntry = resolveBinEntry(packageJson?.bin);
	if (!binEntry) return undefined;

	const executablePath = resolve(dirname(packageJsonPath), binEntry);
	return existsSync(executablePath) && isSpawnableExecutable(executablePath)
		? executablePath
		: undefined;
}

export function resolveNpmClaudeCodeExecutable(): string | undefined {
	const localRequire = createRequire(__filename);

	const agentSdkExecutable = resolveAgentSdkNativeExecutable(localRequire);
	if (agentSdkExecutable) return agentSdkExecutable;

	try {
		const packageJsonPath = localRequire.resolve(`${CLAUDE_CODE_PACKAGE_NAME}/package.json`);
		const packageExecutable = resolveClaudeCodeExecutableFromPackageJson(packageJsonPath);
		if (packageExecutable) return packageExecutable;
	} catch {
		// Fall through to PATH lookup.
	}

	return resolveClaudeExecutableFromPath();
}

export function resolveAgentSdkNativeExecutableFromEntryPoint(
	sdkEntryPointPath: string,
	platform: NodeJS.Platform = process.platform,
	arch: NodeJS.Architecture = process.arch,
	isMusl: boolean = isMuslRuntime(),
): string | undefined {
	const scopedPackageDir = dirname(dirname(sdkEntryPointPath));
	for (const candidate of getNativeExecutableCandidates(platform, arch, isMusl)) {
		const unscopedPackageName = candidate.packageName.startsWith(ANTHROPIC_SCOPE)
			? candidate.packageName.slice(ANTHROPIC_SCOPE.length)
			: candidate.packageName;
		const executablePath = resolve(
			scopedPackageDir,
			unscopedPackageName,
			candidate.executableName,
		);
		if (existsSync(executablePath) && isSpawnableExecutable(executablePath)) return executablePath;
	}

	return undefined;
}

function resolveAgentSdkNativeExecutable(localRequire: NodeRequire): string | undefined {
	try {
		const sdkEntryPointPath = localRequire.resolve(CLAUDE_AGENT_SDK_PACKAGE_NAME);
		return resolveAgentSdkNativeExecutableFromEntryPoint(sdkEntryPointPath);
	} catch {
		return undefined;
	}
}

function getNativeExecutableCandidates(
	platform: NodeJS.Platform,
	arch: NodeJS.Architecture,
	isMusl: boolean,
): NativeExecutableCandidate[] {
	if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
		return [
			{
				packageName: `${ANTHROPIC_SCOPE}claude-agent-sdk-darwin-${arch}`,
				executableName: 'claude',
			},
		];
	}

	if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) {
		const glibcCandidate = {
			packageName: `${ANTHROPIC_SCOPE}claude-agent-sdk-linux-${arch}`,
			executableName: 'claude',
		};
		const muslCandidate = {
			packageName: `${ANTHROPIC_SCOPE}claude-agent-sdk-linux-${arch}-musl`,
			executableName: 'claude',
		};
		return isMusl ? [muslCandidate, glibcCandidate] : [glibcCandidate, muslCandidate];
	}

	if (platform === 'win32' && (arch === 'arm64' || arch === 'x64')) {
		return [
			{
				packageName: `${ANTHROPIC_SCOPE}claude-agent-sdk-win32-${arch}`,
				executableName: 'claude.exe',
			},
		];
	}

	return [];
}

function resolveClaudeExecutableFromPath(pathValue = process.env.PATH): string | undefined {
	if (!pathValue) return undefined;

	for (const pathEntry of pathValue.split(delimiter)) {
		if (!pathEntry) continue;
		const executablePath = resolve(pathEntry, process.platform === 'win32' ? 'claude.exe' : 'claude');
		if (existsSync(executablePath) && isSpawnableExecutable(executablePath)) return executablePath;
	}

	return undefined;
}

function isMuslRuntime(): boolean {
	if (process.platform !== 'linux') return false;
	const report = process.report?.getReport?.() as
		| { header?: { glibcVersionRuntime?: string } }
		| undefined;
	const header = report?.header;
	return !header?.glibcVersionRuntime;
}

function isSpawnableExecutable(executablePath: string): boolean {
	let fd: number | undefined;

	try {
		fd = openSync(executablePath, 'r');
		const header = Buffer.alloc(4);
		const bytesRead = readSync(fd, header, 0, header.length, 0);
		if (bytesRead < 2) return false;

		if (header[0] === 0x23 && header[1] === 0x21) return true; // #!
		if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) {
			return true; // ELF
		}
		if (header[0] === 0x4d && header[1] === 0x5a) return true; // PE/MZ

		const magic = header.readUInt32BE(0);
		return [
			0xcafebabe,
			0xcafed00d,
			0xfeedface,
			0xfeedfacf,
			0xcefaedfe,
			0xcffaedfe,
		].includes(magic);
	} catch {
		return false;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
