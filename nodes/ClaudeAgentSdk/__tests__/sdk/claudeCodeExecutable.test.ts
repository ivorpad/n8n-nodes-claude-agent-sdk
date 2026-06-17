import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { resolveClaudeCodeExecutableFromPackageJson } from '../../sdk/claudeCodeExecutable';

function withTempPackage(
	packageJson: Record<string, unknown>,
	files: string[],
	callback: (packageJsonPath: string) => void,
): void {
	const dir = mkdtempSync(join(tmpdir(), 'claude-code-peer-'));
	try {
		for (const file of files) {
			const filePath = join(dir, file);
			mkdirSync(join(filePath, '..'), { recursive: true });
			writeFileSync(filePath, '#!/usr/bin/env node\n', 'utf8');
		}
		const packageJsonPath = join(dir, 'package.json');
		writeFileSync(packageJsonPath, JSON.stringify(packageJson), 'utf8');
		callback(packageJsonPath);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('resolveClaudeCodeExecutableFromPackageJson', () => {
	it('resolves the claude bin from @anthropic-ai/claude-code package metadata', () => {
		withTempPackage({ bin: { claude: 'bin/claude.exe' } }, ['bin/claude.exe'], (packageJsonPath) => {
			expect(resolveClaudeCodeExecutableFromPackageJson(packageJsonPath)).toBe(
				join(packageJsonPath, '..', 'bin/claude.exe'),
			);
		});
	});

	it('supports string bin metadata', () => {
		withTempPackage({ bin: 'bin/claude.exe' }, ['bin/claude.exe'], (packageJsonPath) => {
			expect(resolveClaudeCodeExecutableFromPackageJson(packageJsonPath)).toBe(
				join(packageJsonPath, '..', 'bin/claude.exe'),
			);
		});
	});

	it('returns undefined when the package does not expose an existing claude bin', () => {
		withTempPackage({ bin: { claude: 'bin/missing' } }, [], (packageJsonPath) => {
			expect(resolveClaudeCodeExecutableFromPackageJson(packageJsonPath)).toBeUndefined();
		});
	});
});
