import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
	resolveAgentSdkNativeExecutableFromEntryPoint,
	resolveClaudeCodeExecutableFromPackageJson,
} from '../../sdk/claudeCodeExecutable';

function withTempPackage(
	packageJson: Record<string, unknown>,
	files: string[],
	callback: (packageJsonPath: string) => void,
): void {
	const dir = mkdtempSync(join(tmpdir(), 'claude-code-package-'));
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

function withTempAgentSdkPackage(callback: (sdkEntryPointPath: string, nativePath: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), 'claude-agent-sdk-package-'));
	try {
		const sdkEntryPointPath = join(
			dir,
			'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
		);
		const nativePath = join(
			dir,
			'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
		);
		mkdirSync(join(sdkEntryPointPath, '..'), { recursive: true });
		mkdirSync(join(nativePath, '..'), { recursive: true });
		writeFileSync(sdkEntryPointPath, 'export {};\n', 'utf8');
		writeFileSync(nativePath, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
		callback(sdkEntryPointPath, nativePath);
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

	it('returns undefined for the npm fallback text stub that cannot be spawned directly', () => {
		const dir = mkdtempSync(join(tmpdir(), 'claude-code-package-'));
		try {
			const executablePath = join(dir, 'bin/claude.exe');
			mkdirSync(join(executablePath, '..'), { recursive: true });
			writeFileSync(
				executablePath,
				'echo "Error: claude native binary not installed." >&2\n',
				'utf8',
			);
			const packageJsonPath = join(dir, 'package.json');
			writeFileSync(
				packageJsonPath,
				JSON.stringify({ bin: { claude: 'bin/claude.exe' } }),
				'utf8',
			);

			expect(resolveClaudeCodeExecutableFromPackageJson(packageJsonPath)).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('resolveAgentSdkNativeExecutableFromEntryPoint', () => {
	it('resolves the native executable installed beside the Claude Agent SDK package', () => {
		withTempAgentSdkPackage((sdkEntryPointPath, nativePath) => {
			expect(
				resolveAgentSdkNativeExecutableFromEntryPoint(
					sdkEntryPointPath,
					'darwin',
					'arm64',
					false,
				),
			).toBe(nativePath);
		});
	});
});
