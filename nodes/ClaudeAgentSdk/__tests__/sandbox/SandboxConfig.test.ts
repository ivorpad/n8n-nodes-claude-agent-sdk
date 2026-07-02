/**
 * Sandbox Configuration Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSandboxConfig } from '../../sandbox';
import type { IExecuteFunctions } from 'n8n-workflow';

describe('SandboxConfig', () => {
	let mockExecFunctions: IExecuteFunctions;
	let mockGetNodeParameter: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockGetNodeParameter = vi.fn();
		mockExecFunctions = {
			getNodeParameter: mockGetNodeParameter,
		} as unknown as IExecuteFunctions;
	});

	/**
		* Helper to set up mock parameter values
		* Defaults all sandbox parameters to their default values
		*/
	function setupMockParams(overrides: Record<string, unknown> = {}) {
		const defaults = {
			enableSandbox: false,
			commandOptions: {
				settings: {
					sandboxAllowAppleEvents: false,
					sandboxAutoAllowBash: false,
					sandboxExcludedCommands: '',
					sandboxFailIfUnavailable: true,
					sandboxAllowUnsandboxed: false,
					sandboxWeakerNested: false,
				},
			},
			networkOptions: {
				settings: {
					sandboxAllowLocalBinding: false,
					sandboxAllowUnixSockets: '',
					sandboxAllowAllUnixSockets: false,
					sandboxHttpProxyPort: 0,
					sandboxSocksProxyPort: 0,
				},
			},
			credentialDenials: {
				settings: {
					sandboxDeniedCredentialFiles: '',
					sandboxDeniedCredentialEnvVars: '',
				},
			},
			violationIgnores: {
				settings: {
					sandboxIgnoreFilePatterns: '',
					sandboxIgnoreNetworkPatterns: '',
				},
			},
		};

		const overrideObj = overrides as {
			enableSandbox?: boolean;
			commandOptions?: { settings?: Record<string, unknown> };
			networkOptions?: { settings?: Record<string, unknown> };
			credentialDenials?: { settings?: Record<string, unknown> };
			violationIgnores?: { settings?: Record<string, unknown> };
		};

		const sandboxConfig = {
			...defaults,
			...overrideObj,
			commandOptions: {
				settings: {
					...defaults.commandOptions.settings,
					...(overrideObj.commandOptions?.settings ?? {}),
				},
			},
			networkOptions: {
				settings: {
					...defaults.networkOptions.settings,
					...(overrideObj.networkOptions?.settings ?? {}),
				},
			},
			credentialDenials: {
				settings: {
					...defaults.credentialDenials.settings,
					...(overrideObj.credentialDenials?.settings ?? {}),
				},
			},
			violationIgnores: {
				settings: {
					...defaults.violationIgnores.settings,
					...(overrideObj.violationIgnores?.settings ?? {}),
				},
			},
		};

		mockGetNodeParameter.mockImplementation((name: string, _index: number, defaultValue: unknown) => {
			if (name === 'sandboxConfig') return sandboxConfig;
			return defaultValue;
		});
	}

	describe('parseSandboxConfig', () => {
		it('should return undefined when sandbox is not enabled', () => {
			setupMockParams({ enableSandbox: false });

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toBeUndefined();
		});

		it('should return basic config when sandbox is enabled', () => {
			setupMockParams({ enableSandbox: true });

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
			});
		});

		it('should parse autoAllowBashIfSandboxed option', () => {
			setupMockParams({
				enableSandbox: true,
				commandOptions: {
					settings: {
						sandboxAutoAllowBash: true,
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: true,
			});
		});

		it('should parse excludedCommands as comma-separated list', () => {
			setupMockParams({
				enableSandbox: true,
				commandOptions: {
					settings: {
						sandboxExcludedCommands: 'docker, kubectl, npm',
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
				excludedCommands: ['docker', 'kubectl', 'npm'],
			});
		});

		it('should handle empty excludedCommands string', () => {
			setupMockParams({
				enableSandbox: true,
				commandOptions: {
					settings: {
						sandboxExcludedCommands: '',
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
			});
			expect(result?.excludedCommands).toBeUndefined();
		});

		it('should parse allowUnsandboxedCommands option', () => {
			setupMockParams({
				enableSandbox: true,
				commandOptions: {
					settings: {
						sandboxAllowUnsandboxed: true,
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
				allowUnsandboxedCommands: true,
			});
		});

		it('should parse enableWeakerNestedSandbox option', () => {
			setupMockParams({
				enableSandbox: true,
				commandOptions: {
					settings: {
						sandboxWeakerNested: true,
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
				enableWeakerNestedSandbox: true,
			});
		});

		it('should parse Apple Events and credential denial settings', () => {
			setupMockParams({
				enableSandbox: true,
				commandOptions: {
					settings: {
						sandboxAllowAppleEvents: true,
					},
				},
				credentialDenials: {
					settings: {
						sandboxDeniedCredentialFiles: '~/.aws/credentials, .env',
						sandboxDeniedCredentialEnvVars: 'AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN',
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
				allowAppleEvents: true,
				credentials: {
					files: [
						{ path: '~/.aws/credentials', mode: 'deny' },
						{ path: '.env', mode: 'deny' },
					],
					envVars: [
						{ name: 'AWS_SECRET_ACCESS_KEY', mode: 'deny' },
						{ name: 'GITHUB_TOKEN', mode: 'deny' },
					],
				},
			});
		});

		it('should parse network settings', () => {
			setupMockParams({
				enableSandbox: true,
				networkOptions: {
					settings: {
						sandboxAllowLocalBinding: true,
						sandboxAllowUnixSockets: '/var/run/docker.sock, /tmp/app.sock',
						sandboxHttpProxyPort: 8080,
						sandboxSocksProxyPort: 1080,
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
				network: {
					allowLocalBinding: true,
					allowUnixSockets: ['/var/run/docker.sock', '/tmp/app.sock'],
					httpProxyPort: 8080,
					socksProxyPort: 1080,
				},
			});
		});

		it('should skip network config if no settings are set', () => {
			setupMockParams({
				enableSandbox: true,
				networkOptions: {
					settings: {
						sandboxAllowLocalBinding: false,
						sandboxAllowAllUnixSockets: false,
						sandboxHttpProxyPort: 0,
						sandboxSocksProxyPort: 0,
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
			});
			expect(result?.network).toBeUndefined();
		});

		it('should parse allowAllUnixSockets option', () => {
			setupMockParams({
				enableSandbox: true,
				networkOptions: {
					settings: {
						sandboxAllowAllUnixSockets: true,
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
				network: {
					allowAllUnixSockets: true,
				},
			});
		});

		it('should parse ignoreViolations settings', () => {
			setupMockParams({
				enableSandbox: true,
				violationIgnores: {
					settings: {
						sandboxIgnoreFilePatterns: '/tmp/*, /var/cache/*',
						sandboxIgnoreNetworkPatterns: 'localhost:*, 127.0.0.1:8080',
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
				ignoreViolations: {
					file: ['/tmp/*', '/var/cache/*'],
					network: ['localhost:*', '127.0.0.1:8080'],
				},
			});
		});

		it('should skip ignoreViolations if patterns are empty', () => {
			setupMockParams({
				enableSandbox: true,
				violationIgnores: {
					settings: {
						sandboxIgnoreFilePatterns: '',
						sandboxIgnoreNetworkPatterns: '',
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: false,
			});
			expect(result?.ignoreViolations).toBeUndefined();
		});

		it('should parse full configuration with all options', () => {
			setupMockParams({
				enableSandbox: true,
				commandOptions: {
					settings: {
						sandboxAutoAllowBash: true,
						sandboxAllowAppleEvents: true,
						sandboxExcludedCommands: 'docker, kubectl',
						sandboxAllowUnsandboxed: true,
						sandboxWeakerNested: true,
					},
				},
				networkOptions: {
					settings: {
						sandboxAllowLocalBinding: true,
						sandboxAllowUnixSockets: '/var/run/docker.sock',
						sandboxAllowedDomains: 'api.github.com',
						sandboxDeniedDomains: '169.254.169.254',
						sandboxHttpProxyPort: 8080,
						sandboxSocksProxyPort: 1080,
					},
				},
				credentialDenials: {
					settings: {
						sandboxDeniedCredentialFiles: '~/.aws/credentials',
						sandboxDeniedCredentialEnvVars: 'AWS_SECRET_ACCESS_KEY',
					},
				},
				violationIgnores: {
					settings: {
						sandboxIgnoreFilePatterns: '/tmp/*',
						sandboxIgnoreNetworkPatterns: 'localhost:*',
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result).toEqual({
				enabled: true,
				autoAllowBashIfSandboxed: true,
				excludedCommands: ['docker', 'kubectl'],
				allowUnsandboxedCommands: true,
				enableWeakerNestedSandbox: true,
				allowAppleEvents: true,
				network: {
					allowLocalBinding: true,
					allowUnixSockets: ['/var/run/docker.sock'],
					allowedDomains: ['api.github.com'],
					deniedDomains: ['169.254.169.254'],
					httpProxyPort: 8080,
					socksProxyPort: 1080,
				},
				credentials: {
					files: [{ path: '~/.aws/credentials', mode: 'deny' }],
					envVars: [{ name: 'AWS_SECRET_ACCESS_KEY', mode: 'deny' }],
				},
				ignoreViolations: {
					file: ['/tmp/*'],
					network: ['localhost:*'],
				},
			});
		});

		it('should handle whitespace in comma-separated lists', () => {
			setupMockParams({
				enableSandbox: true,
				commandOptions: {
					settings: {
						sandboxExcludedCommands: '  docker  ,  kubectl  ,  npm  ',
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result?.excludedCommands).toEqual(['docker', 'kubectl', 'npm']);
		});

		it('should filter empty items from comma-separated lists', () => {
			setupMockParams({
				enableSandbox: true,
				commandOptions: {
					settings: {
						sandboxExcludedCommands: 'docker,,kubectl,, ,npm',
					},
				},
			});

			const result = parseSandboxConfig(mockExecFunctions, 0);

			expect(result?.excludedCommands).toEqual(['docker', 'kubectl', 'npm']);
		});
	});
});
