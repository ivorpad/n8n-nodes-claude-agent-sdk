/**
 * parsePermissionsConfig Unit Tests
 *
 * Tests for parsing permission configuration from n8n node parameters,
 * including the blockEnvFiles default security option.
 */

import { describe, it, expect } from 'vitest';
import { ApplicationError } from 'n8n-workflow';
import { parsePermissionsConfig, ENV_FILE_PROTECTION_RULES } from '../../permissions';
import { createMockExecuteFunctions } from '../helpers/mockExecuteFunctions';

describe('parsePermissionsConfig', () => {
	describe('blockEnvFiles parameter', () => {
		it('should enable env file protection by default when parameter is not set', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {},
				// blockEnvFiles not set, should default to true
			});

			const config = parsePermissionsConfig(mockExec, 0);

			// Content filter should be enabled with env protection rules
			expect(config.contentFilter).toBeDefined();
			expect(config.contentFilter?.enabled).toBe(true);
			expect(config.contentFilter?.rules).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: 'env-file-path' }),
				]),
			);
		});

		it('should enable env file protection when blockEnvFiles is explicitly true', () => {
			const mockExec = createMockExecuteFunctions({
				blockEnvFiles: true,
				securityOptions: {},
			});

			const config = parsePermissionsConfig(mockExec, 0);

			expect(config.contentFilter).toBeDefined();
			expect(config.contentFilter?.enabled).toBe(true);
			expect(config.contentFilter?.rules.length).toBeGreaterThan(0);
		});

		it('should disable env file protection when blockEnvFiles is false', () => {
			const mockExec = createMockExecuteFunctions({
				blockEnvFiles: false,
				securityOptions: {},
			});

			const config = parsePermissionsConfig(mockExec, 0);

			// When blockEnvFiles is false and no other security options are set,
			// content filter should not be enabled
			if (config.contentFilter) {
				// If contentFilter exists, it should not have env protection rules
				const hasEnvRules = config.contentFilter.rules.some(
					(r) => r.id.startsWith('env-'),
				);
				expect(hasEnvRules).toBe(false);
			}
		});

		it('should merge env protection rules with existing content filter rules', () => {
			const mockExec = createMockExecuteFunctions({
				blockEnvFiles: true,
				securityOptions: {
					contentFilter: {
						settings: {
							enabled: true,
							presets: ['dangerous-commands'],
							customRules: '[]',
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);

			expect(config.contentFilter).toBeDefined();
			expect(config.contentFilter?.enabled).toBe(true);
			// Should have env protection rules
			expect(config.contentFilter?.rules).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: 'env-file-path' }),
				]),
			);
			// Should also have dangerous-commands preset
			expect(config.contentFilter?.presets).toContain('dangerous-commands');
		});

		it('should prepend env protection rules (higher priority) when merged', () => {
			const customRule = {
				id: 'custom-rule',
				pattern: 'test',
				tools: ['Bash'],
				targetField: 'command',
			};

			const mockExec = createMockExecuteFunctions({
				blockEnvFiles: true,
				securityOptions: {
					contentFilter: {
						settings: {
							enabled: true,
							presets: [],
							customRules: JSON.stringify([customRule]),
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);

			// Env protection rules should come first (higher priority)
			const firstRuleId = config.contentFilter?.rules[0]?.id;
			expect(firstRuleId).toMatch(/^env-/);
		});

		it('should include all env protection rules when enabled', () => {
			const mockExec = createMockExecuteFunctions({
				blockEnvFiles: true,
				securityOptions: {},
			});

			const config = parsePermissionsConfig(mockExec, 0);

			// Should have rules for file path and bash commands
			const rules = config.contentFilter?.rules || [];
			const ruleIds = rules.map((r) => r.id);

			expect(ruleIds).toContain('env-file-path');
			expect(ruleIds).toContain('env-glob-path');
			expect(ruleIds).toContain('env-glob-pattern');
			expect(ruleIds).toContain('env-grep-path');
			expect(ruleIds).toContain('env-bash-any-env-reference');
			expect(ruleIds).toContain('env-bash-read');
			expect(ruleIds).toContain('env-bash-source');
			expect(ruleIds).toContain('env-bash-grep');
			expect(ruleIds).toContain('env-bash-glob-patterns');
			expect(ruleIds).toContain('env-bash-escaped-env-reference');
			expect(ruleIds).toContain('env-bash-printenv');
			expect(ruleIds).toContain('env-bash-env-dump');
			expect(ruleIds).toContain('env-bash-runtime-env-access');
		});
	});

	describe('interaction with other security options', () => {
		it('should work alongside path sandbox', () => {
			const mockExec = createMockExecuteFunctions({
				blockEnvFiles: true,
				securityOptions: {
					pathSandbox: {
						settings: {
							enabled: true,
							basePathMode: 'custom',
							basePath: '/project',
							affectedTools: ['Read', 'Write'],
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0, undefined, '/workspace');

			// Both should be enabled
			expect(config.pathSandbox?.enabled).toBe(true);
			expect(config.contentFilter?.enabled).toBe(true);
		});

		it('should work alongside tool permissions', () => {
			const mockExec = createMockExecuteFunctions({
				blockEnvFiles: true,
				securityOptions: {
					toolPermissions: {
						settings: {
							enabled: true,
							defaultDecision: 'allow',
							askFallback: 'deny',
							rules: '[]',
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);

			expect(config.toolPermissions?.enabled).toBe(true);
			expect(config.contentFilter?.enabled).toBe(true);
		});

		it('should work alongside audit logging', () => {
			const mockExec = createMockExecuteFunctions({
				blockEnvFiles: true,
				securityOptions: {
					auditLogging: {
						settings: {
							enabled: true,
							logInputs: true,
							logOutputs: false,
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);

			expect(config.auditLogger?.enabled).toBe(true);
			expect(config.contentFilter?.enabled).toBe(true);
		});
	});

	describe('pathSandbox validation', () => {
		it('should throw when path sandbox is enabled without a basePath', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					pathSandbox: {
						settings: {
							enabled: true,
							basePathMode: 'custom',
							basePath: '   ',
							affectedTools: ['Read'],
						},
					},
				},
			});

			expect(() => parsePermissionsConfig(mockExec, 0)).toThrow(ApplicationError);
			expect(() => parsePermissionsConfig(mockExec, 0)).toThrow(
				'Path sandbox is enabled with Custom Path mode but no base path was provided. Set a sandbox base path or switch to Working Directory mode.',
			);
		});

		it('should throw when path sandbox basePath is not absolute', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					pathSandbox: {
						settings: {
							enabled: true,
							basePathMode: 'custom',
							basePath: './project',
							affectedTools: ['Read'],
						},
					},
				},
			});

			expect(() => parsePermissionsConfig(mockExec, 0)).toThrow(ApplicationError);
			expect(() => parsePermissionsConfig(mockExec, 0)).toThrow('Path sandbox base path must be an absolute path.');
		});
	});

	describe('agtGovernance parsing', () => {
		it('should parse a valid AGT config with rules', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					agtGovernance: {
						settings: {
							enabled: true,
							defaultAction: 'deny',
							conflictStrategy: 'denyOverrides',
							agentDid: 'did:agentmesh:test',
							rules: {
								values: [
									{
										name: 'allow-reads',
										tools: ['Read', 'Glob'],
										decision: 'allow',
										priority: 100,
									},
								],
							},
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);

			expect(config.agtGovernance).toBeDefined();
			expect(config.agtGovernance?.enabled).toBe(true);
			expect(config.agtGovernance?.defaultAction).toBe('deny');
			expect(config.agtGovernance?.conflictStrategy).toBe('denyOverrides');
			expect(config.agtGovernance?.agentDid).toBe('did:agentmesh:test');
			expect(config.agtGovernance?.rules).toHaveLength(1);
			expect(config.agtGovernance?.rules[0].tools).toEqual(['Read', 'Glob']);
		});

		it('should auto-name blank rules', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					agtGovernance: {
						settings: {
							enabled: true,
							rules: {
								values: [
									{ name: '', tools: ['Read'], decision: 'allow', priority: 100 },
									{ name: '  ', tools: ['Write'], decision: 'deny', priority: 200 },
								],
							},
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);

			expect(config.agtGovernance?.rules[0].name).toBe('rule-1');
			expect(config.agtGovernance?.rules[1].name).toBe('rule-2');
		});

		it('should split and trim approvers CSV', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					agtGovernance: {
						settings: {
							enabled: true,
							rules: {
								values: [{
									name: 'r1',
									tools: ['Write'],
									decision: 'require_approval',
									priority: 100,
									approvers: '  admin@co.com , ops@co.com  , ',
								}],
							},
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);
			expect(config.agtGovernance?.rules[0].approvers).toEqual(['admin@co.com', 'ops@co.com']);
		});

		it('should normalise blank limit to undefined', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					agtGovernance: {
						settings: {
							enabled: true,
							rules: {
								values: [{
									name: 'r1', tools: ['Read'], decision: 'allow',
									priority: 100, limit: '  ',
								}],
							},
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);
			expect(config.agtGovernance?.rules[0].limit).toBeUndefined();
		});

		it('should normalise blank agentDid to undefined', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					agtGovernance: {
						settings: {
							enabled: true,
							agentDid: '  ',
							rules: { values: [] },
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);
			expect(config.agtGovernance?.agentDid).toBeUndefined();
		});

		it('should throw when a rule has no tools', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					agtGovernance: {
						settings: {
							enabled: true,
							rules: {
								values: [{
									name: 'bad-rule', tools: [], decision: 'deny', priority: 100,
								}],
							},
						},
					},
				},
			});

			expect(() => parsePermissionsConfig(mockExec, 0)).toThrow(ApplicationError);
			expect(() => parsePermissionsConfig(mockExec, 0)).toThrow('no tools');
		});

		it('should normalise empty conditions to undefined', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					agtGovernance: {
						settings: {
							enabled: true,
							rules: {
								values: [{
									name: 'r1', tools: ['Read'], decision: 'allow',
									priority: 100, conditions: { conditions: [] },
								}],
							},
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);
			expect(config.agtGovernance?.rules[0].conditions).toBeUndefined();
		});

		it('should accept zero rules', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					agtGovernance: {
						settings: {
							enabled: true,
							defaultAction: 'allow',
							rules: { values: [] },
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);
			expect(config.agtGovernance?.enabled).toBe(true);
			expect(config.agtGovernance?.rules).toHaveLength(0);
		});

		it('should not parse AGT when disabled', () => {
			const mockExec = createMockExecuteFunctions({
				securityOptions: {
					agtGovernance: {
						settings: {
							enabled: false,
						},
					},
				},
			});

			const config = parsePermissionsConfig(mockExec, 0);
			expect(config.agtGovernance).toBeUndefined();
		});
	});

	describe('ENV_FILE_PROTECTION_RULES structure', () => {
		it('should export ENV_FILE_PROTECTION_RULES', () => {
			expect(ENV_FILE_PROTECTION_RULES).toBeDefined();
			expect(Array.isArray(ENV_FILE_PROTECTION_RULES)).toBe(true);
		});

		it('should have correct rule structure', () => {
			for (const rule of ENV_FILE_PROTECTION_RULES) {
				expect(rule.id).toBeDefined();
				expect(rule.description).toBeDefined();
				expect(rule.pattern).toBeDefined();
				expect(rule.tools).toBeDefined();
				expect(Array.isArray(rule.tools)).toBe(true);
				expect(rule.targetField).toBeDefined();
			}
		});

		it('should have file_path rules for Read, Write, Edit tools', () => {
			const filePathRule = ENV_FILE_PROTECTION_RULES.find(
				(r) => r.id === 'env-file-path',
			);

			expect(filePathRule).toBeDefined();
			expect(filePathRule?.tools).toContain('Read');
			expect(filePathRule?.tools).toContain('Write');
			expect(filePathRule?.tools).toContain('Edit');
			expect(filePathRule?.targetField).toBe('file_path');
		});

		it('should have command rules for Bash tool', () => {
			const bashRules = ENV_FILE_PROTECTION_RULES.filter((r) =>
				r.tools.includes('Bash'),
			);

			expect(bashRules.length).toBeGreaterThan(0);
			for (const rule of bashRules) {
				expect(rule.targetField).toBe('command');
			}
		});
	});
});
