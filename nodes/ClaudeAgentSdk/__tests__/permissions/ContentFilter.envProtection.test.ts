/**
 * ContentFilter ENV file protection rules tests
 */

import { describe, it, expect } from 'vitest';
import { checkContentFilter, ENV_FILE_PROTECTION_RULES } from '../../permissions/ContentFilter';
import type { ContentFilterConfig, PreToolUseHookInput } from '../../permissions/types';

describe('ContentFilter - env file protection rules', () => {
	const createHookInput = (
		toolName: string,
		toolInput: Record<string, unknown>,
	): PreToolUseHookInput => ({
		session_id: 'test-session',
		transcript_path: '/tmp/transcript',
		cwd: '/project',
		hook_event_name: 'PreToolUse',
		tool_name: toolName,
		tool_input: toolInput,
	});

	describe('ENV_FILE_PROTECTION_RULES', () => {
		it('should export ENV_FILE_PROTECTION_RULES array', () => {
			expect(ENV_FILE_PROTECTION_RULES).toBeDefined();
			expect(Array.isArray(ENV_FILE_PROTECTION_RULES)).toBe(true);
			expect(ENV_FILE_PROTECTION_RULES.length).toBeGreaterThan(0);
		});

		it('should have rules for file path and bash commands', () => {
			const filePathRules = ENV_FILE_PROTECTION_RULES.filter((r) => r.targetField === 'file_path');
			const commandRules = ENV_FILE_PROTECTION_RULES.filter((r) => r.targetField === 'command');

			expect(filePathRules.length).toBeGreaterThan(0);
			expect(commandRules.length).toBeGreaterThan(0);
		});
	});

	describe('checkContentFilter - env file protection (file_path)', () => {
		const config: ContentFilterConfig = {
			enabled: true,
			rules: ENV_FILE_PROTECTION_RULES,
		};

		describe('should block .env files', () => {
			it('should block .env', () => {
				const input = createHookInput('Read', { file_path: '/project/.env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-file-path');
			});

			it('should block .env.local', () => {
				const input = createHookInput('Read', { file_path: '/project/.env.local' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block .env.production', () => {
				const input = createHookInput('Read', { file_path: '/project/.env.production' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block .env.development', () => {
				const input = createHookInput('Read', { file_path: '/project/.env.development' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block .env.staging', () => {
				const input = createHookInput('Read', { file_path: '/project/.env.staging' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block .env.test', () => {
				const input = createHookInput('Read', { file_path: '/project/.env.test' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block .env.example', () => {
				const input = createHookInput('Read', { file_path: '/project/.env.example' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block .env.sample', () => {
				const input = createHookInput('Read', { file_path: '/project/.env.sample' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block .env.backup', () => {
				const input = createHookInput('Read', { file_path: '/project/.env.backup' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block uppercase .ENV variants', () => {
				const input = createHookInput('Read', { file_path: '/project/.ENV.LOCAL' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block .env in nested directories', () => {
				const input = createHookInput('Read', { file_path: '/project/apps/api/.env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block .env.local in nested directories', () => {
				const input = createHookInput('Read', { file_path: '/home/user/projects/myapp/.env.local' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});
		});

		describe('should block for all affected tools', () => {
			it('should block Read tool', () => {
				const input = createHookInput('Read', { file_path: '/project/.env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block Write tool', () => {
				const input = createHookInput('Write', { file_path: '/project/.env', content: 'SECRET=value' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block Edit tool', () => {
				const input = createHookInput('Edit', { file_path: '/project/.env', old_string: 'OLD', new_string: 'NEW' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block Glob tool when path is .env', () => {
				const input = createHookInput('Glob', { path: '/project/.env', pattern: '*' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-glob-path');
			});

			it('should block Glob tool when pattern can resolve to .env', () => {
				const input = createHookInput('Glob', { path: '/project', pattern: '.en*' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-glob-pattern');
			});

			it('should block Grep tool when path is .env', () => {
				const input = createHookInput('Grep', { path: '/project/.env', pattern: 'API_KEY' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-grep-path');
			});
		});

		describe('should allow non-.env files', () => {
			it('should allow regular TypeScript files', () => {
				const input = createHookInput('Read', { file_path: '/project/src/app.ts' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow environment.ts config file', () => {
				const input = createHookInput('Read', { file_path: '/project/src/environment.ts' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow .envrc (direnv file)', () => {
				const input = createHookInput('Read', { file_path: '/project/.envrc' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow env.ts or env.js files', () => {
				const input = createHookInput('Read', { file_path: '/project/config/env.ts' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow package.json', () => {
				const input = createHookInput('Read', { file_path: '/project/package.json' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow README.md', () => {
				const input = createHookInput('Read', { file_path: '/project/README.md' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});
		});
	});

	describe('checkContentFilter - env file protection (Bash commands)', () => {
		const config: ContentFilterConfig = {
			enabled: true,
			rules: ENV_FILE_PROTECTION_RULES,
		};

		describe('should block reading .env files via bash', () => {
			it('should block cat .env', () => {
				const input = createHookInput('Bash', { command: 'cat .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-read');
			});

			it('should block cat /path/to/.env', () => {
				const input = createHookInput('Bash', { command: 'cat /project/.env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block cat .ENV (case-insensitive)', () => {
				const input = createHookInput('Bash', { command: 'cat .ENV' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block cat .env.local', () => {
				const input = createHookInput('Bash', { command: 'cat .env.local' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block head .env', () => {
				const input = createHookInput('Bash', { command: 'head .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block head -n 10 .env', () => {
				const input = createHookInput('Bash', { command: 'head -n 10 .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block tail .env', () => {
				const input = createHookInput('Bash', { command: 'tail .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block tail -f .env.production', () => {
				const input = createHookInput('Bash', { command: 'tail -f .env.production' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block less .env', () => {
				const input = createHookInput('Bash', { command: 'less .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block more .env', () => {
				const input = createHookInput('Bash', { command: 'more .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block bat .env (modern cat alternative)', () => {
				const input = createHookInput('Bash', { command: 'bat .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});
		});

		describe('should block sourcing .env files', () => {
			it('should block source .env', () => {
				const input = createHookInput('Bash', { command: 'source .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(['env-bash-source', 'env-bash-any-env-reference']).toContain(result.matchedRule);
			});

			it('should block . .env (dot notation)', () => {
				const input = createHookInput('Bash', { command: '. .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block source .env.local', () => {
				const input = createHookInput('Bash', { command: 'source .env.local' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block . /path/to/.env.production', () => {
				const input = createHookInput('Bash', { command: '. /project/.env.production' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});
		});

		describe('should block grep/search in .env files', () => {
			it('should block grep .env', () => {
				const input = createHookInput('Bash', { command: 'grep SECRET .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-grep');
			});

			it('should block grep -i password .env.local', () => {
				const input = createHookInput('Bash', { command: 'grep -i password .env.local' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block awk on .env', () => {
				const input = createHookInput('Bash', { command: "awk -F= '{print $2}' .env" });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block sed on .env', () => {
				const input = createHookInput('Bash', { command: "sed -n 's/API_KEY=//p' .env" });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});
		});

		describe('should allow safe bash commands', () => {
			it('should allow ls -la', () => {
				const input = createHookInput('Bash', { command: 'ls -la' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow cat package.json', () => {
				const input = createHookInput('Bash', { command: 'cat package.json' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow cat src/env.ts', () => {
				const input = createHookInput('Bash', { command: 'cat src/env.ts' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow git status', () => {
				const input = createHookInput('Bash', { command: 'git status' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow npm install', () => {
				const input = createHookInput('Bash', { command: 'npm install' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow cat .envrc (direnv)', () => {
				const input = createHookInput('Bash', { command: 'cat .envrc' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow grep in regular files', () => {
				const input = createHookInput('Bash', { command: 'grep TODO src/*.ts' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow grep of process.env text in source code files', () => {
				const input = createHookInput('Bash', { command: 'grep process.env src/**/*.ts' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow echo with env variable (not reading file)', () => {
				const input = createHookInput('Bash', { command: 'echo $HOME' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});

			it('should allow env command used to set process env for a command', () => {
				const input = createHookInput('Bash', { command: 'env NODE_ENV=production node app.js' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(false);
			});
		});

		describe('edge cases and bypass attempts', () => {
			it('should block cat with path traversal to .env', () => {
				const input = createHookInput('Bash', { command: 'cat ../../../.env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block cat with quoted path to .env', () => {
				const input = createHookInput('Bash', { command: 'cat ".env"' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block cat with single quoted path to .env', () => {
				const input = createHookInput('Bash', { command: "cat '.env'" });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block compound command with .env access', () => {
				const input = createHookInput('Bash', { command: 'cd /project && cat .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block piped command accessing .env', () => {
				const input = createHookInput('Bash', { command: 'cat .env | grep API' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block python inline read of .env', () => {
				const input = createHookInput('Bash', {
					command: "python -c \"print(open('.env').read())\"",
				});
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-any-env-reference');
			});

			it('should block shell redirection from .env', () => {
				const input = createHookInput('Bash', { command: 'xargs < .env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-any-env-reference');
			});

			it('should block process substitution with .env', () => {
				const input = createHookInput('Bash', { command: 'cat < .env.local' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-read');
			});

			it('should block variable-expanded absolute env path', () => {
				const input = createHookInput('Bash', { command: 'cat ${PWD}/.env' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block command substitution using cat .env', () => {
				const input = createHookInput('Bash', { command: 'printf %s \"$(cat .env)\"' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block node inline read of .env', () => {
				const input = createHookInput('Bash', {
					command: "node -e \"const fs=require('fs');console.log(fs.readFileSync('.env','utf8'))\"",
				});
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-any-env-reference');
			});

			it('should block ruby inline read of .env', () => {
				const input = createHookInput('Bash', { command: "ruby -e \"puts File.read('.env')\"" });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-any-env-reference');
			});

			it('should block perl read of .env', () => {
				const input = createHookInput('Bash', { command: "perl -ne 'print' .env" });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-any-env-reference');
			});

			it('should block wildcard pattern .en? that resolves to .env', () => {
				const input = createHookInput('Bash', { command: 'cat .en?' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block wildcard pattern .en* that resolves to .env', () => {
				const input = createHookInput('Bash', { command: 'cat .en*' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block bracket wildcard .e[n]v that resolves to .env', () => {
				const input = createHookInput('Bash', { command: 'cat .e[n]v' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block variable indirection to .env path', () => {
				const input = createHookInput('Bash', { command: "f='.env'; cat \"$f\"" });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
			});

			it('should block escaped env references using ANSI-C style hex sequences', () => {
				const input = createHookInput('Bash', { command: "cat $'\\x2eenv'" });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-escaped-env-reference');
			});

			it('should block escaped env references that hide env letters', () => {
				const input = createHookInput('Bash', { command: "cat $'.\\x65nv'" });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-escaped-env-reference');
			});

			it('should block printenv command exfiltration', () => {
				const input = createHookInput('Bash', { command: 'printenv GEMINI_API_KEY' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-printenv');
			});

			it('should block standalone env dump in pipelines', () => {
				const input = createHookInput('Bash', { command: 'env | grep GEMINI_API_KEY' });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-env-dump');
			});

			it('should block runtime script access to process environment', () => {
				const input = createHookInput('Bash', { command: "node -e \"console.log(process.env.GEMINI_API_KEY)\"" });
				const result = checkContentFilter(input, config);
				expect(result.blocked).toBe(true);
				expect(result.matchedRule).toBe('env-bash-runtime-env-access');
			});
		});
	});
});
