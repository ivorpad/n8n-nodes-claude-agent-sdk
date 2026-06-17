import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const CLAUDE_CODE_PACKAGE_NAME = '@anthropic-ai/claude-code';

interface ClaudeCodePackageJson {
	bin?: string | Record<string, string>;
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
	return existsSync(executablePath) ? executablePath : undefined;
}

export function resolveNpmClaudeCodeExecutable(): string | undefined {
	try {
		const localRequire = createRequire(__filename);
		const packageJsonPath = localRequire.resolve(`${CLAUDE_CODE_PACKAGE_NAME}/package.json`);
		return resolveClaudeCodeExecutableFromPackageJson(packageJsonPath);
	} catch {
		return undefined;
	}
}
