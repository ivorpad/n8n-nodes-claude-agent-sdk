/**
 * Content Filtering
 *
 * Blocks tool usage based on content patterns (regex).
 * Includes built-in presets for common security concerns.
 *
 * Security: Rejects unsafe user-defined patterns before compiling regexes.
 * Security: Uses shell-quote to parse bash commands for better detection.
 */

import safeRegex from 'safe-regex2';
import { parse as parseShell } from 'shell-quote';
import type {
	ContentBlockRule,
	ContentFilterConfig,
	ContentFilterResult,
	ContentFilterPreset,
	PreToolUseHookInput,
	ContentFilterTool,
	ContentFilterTarget,
} from './types';

// =============================================================================
// Built-in Presets
// =============================================================================

const DANGEROUS_COMMANDS_PRESET: ContentBlockRule[] = [
	{
		id: 'dangerous-rm-rf',
		description: 'Block recursive force delete',
		pattern: 'rm\\s+(-[^\\s]*r[^\\s]*f|--recursive.*--force|--force.*--recursive)',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'dangerous-chmod-777',
		description: 'Block world-writable permissions',
		pattern: 'chmod\\s+([0-7]*7[0-7]{2}|a\\+rwx)',
		tools: ['Bash'],
		targetField: 'command',
	},
	{
		id: 'dangerous-curl-pipe-sh',
		description: 'Block piping remote scripts to shell',
		pattern: '(curl|wget)\\s+[^|]*\\|\\s*(ba)?sh',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'dangerous-sudo',
		description: 'Block sudo commands',
		pattern: '\\bsudo\\s+',
		tools: ['Bash'],
		targetField: 'command',
	},
	{
		id: 'dangerous-dd',
		description: 'Block dd to/from devices',
		pattern: '\\bdd\\s+.*\\b(if|of)=/dev/',
		tools: ['Bash'],
		targetField: 'command',
	},
	{
		id: 'dangerous-mkfs',
		description: 'Block filesystem formatting',
		pattern: '\\bmkfs\\.',
		tools: ['Bash'],
		targetField: 'command',
	},
	{
		id: 'dangerous-fork-bomb',
		description: 'Block fork bomb patterns',
		pattern: ':\\(\\)\\{\\s*:\\|:\\s*&\\s*\\};:',
		tools: ['Bash'],
		targetField: 'command',
	},
];

const SECRETS_PATTERNS_PRESET: ContentBlockRule[] = [
	{
		id: 'secrets-api-key',
		description: 'Block API key literals',
		pattern: '(api[_-]?key|apikey)[\\s]*[=:][\\s]*[\'"][^\'"]{10,}[\'"]',
		tools: ['Write', 'Edit'],
		targetField: 'content',
		caseInsensitive: true,
	},
	{
		id: 'secrets-aws-key',
		description: 'Block AWS secret keys',
		pattern: 'aws[_-]?secret[_-]?access[_-]?key',
		tools: ['Write', 'Edit'],
		targetField: 'content',
		caseInsensitive: true,
	},
	{
		id: 'secrets-private-key',
		description: 'Block private key content',
		pattern: '-----BEGIN\\s+(RSA\\s+|EC\\s+|DSA\\s+|OPENSSH\\s+)?PRIVATE\\s+KEY-----',
		tools: ['Write', 'Edit'],
		targetField: 'content',
	},
	{
		id: 'secrets-password-literal',
		description: 'Block hardcoded passwords',
		pattern: '(password|passwd|pwd)[\\s]*[=:][\\s]*[\'"][^\'"]{4,}[\'"]',
		tools: ['Write', 'Edit'],
		targetField: 'content',
		caseInsensitive: true,
	},
	{
		id: 'secrets-bearer-token',
		description: 'Block bearer tokens',
		pattern: 'Bearer\\s+[A-Za-z0-9\\-_=]+\\.[A-Za-z0-9\\-_=]+',
		tools: ['Write', 'Edit'],
		targetField: 'content',
	},
];

const SYSTEM_FILES_PRESET: ContentBlockRule[] = [
	{
		id: 'system-passwd-shadow',
		description: 'Block access to passwd/shadow',
		pattern: '/etc/(passwd|shadow|sudoers)',
		tools: ['Read', 'Write', 'Edit'],
		targetField: 'file_path',
	},
	{
		id: 'system-ssh-keys',
		description: 'Block access to SSH keys',
		pattern: '\\.ssh/(id_rsa|id_ed25519|id_ecdsa|authorized_keys)',
		tools: ['Read', 'Write', 'Edit'],
		targetField: 'file_path',
	},
	{
		id: 'system-env-files',
		description: 'Block access to .env files',
		pattern: '\\.env(\\.local|\\.production|\\.development)?$',
		tools: ['Read', 'Write', 'Edit'],
		targetField: 'file_path',
	},
	{
		id: 'system-credentials',
		description: 'Block access to credential files',
		pattern: '(credentials|secrets)\\.(json|yaml|yml)$',
		tools: ['Read', 'Write', 'Edit'],
		targetField: 'file_path',
		caseInsensitive: true,
	},
];

export const PRESETS: Record<ContentFilterPreset, ContentBlockRule[]> = {
	'dangerous-commands': DANGEROUS_COMMANDS_PRESET,
	'secrets-patterns': SECRETS_PATTERNS_PRESET,
	'system-files': SYSTEM_FILES_PRESET,
};

// =============================================================================
// Env File Protection Rules (Default Security)
// =============================================================================

/**
 * Standalone env file protection rules - enabled by default via blockEnvFiles parameter.
 * More comprehensive than the system-files preset (covers all .env variants and Bash commands).
 */
export const ENV_FILE_PROTECTION_RULES: ContentBlockRule[] = [
	{
		id: 'env-file-path',
		description: 'Block access to .env files',
		pattern: '(?:^|[\\\\/])\\.env(?:\\.[A-Za-z0-9_-]+)*$',
		tools: ['Read', 'Write', 'Edit'],
		targetField: 'file_path',
		caseInsensitive: true,
	},
	{
		id: 'env-glob-path',
		description: 'Block glob path targets that point to .env files',
		pattern: '(?:^|[\\\\/])\\.env(?:\\.[A-Za-z0-9_-]+)*$',
		tools: ['Glob'],
		targetField: 'path',
		caseInsensitive: true,
	},
	{
		id: 'env-glob-pattern',
		description: 'Block glob patterns that can resolve to .env files',
		pattern:
			'(?:(?:^|[\\\\/])\\.env(?:\\.[A-Za-z0-9_-]+)*(?:$|[^A-Za-z0-9_]))|' +
			'(\\.en(?:\\*|\\?|\\[[^\\]]+\\]))|' +
			'(\\.env(?:\\*|\\?))|' +
			'(\\.e\\[[^\\]]+\\]v)',
		tools: ['Glob'],
		targetField: 'pattern',
		caseInsensitive: true,
	},
	{
		id: 'env-grep-path',
		description: 'Block grep path targets that point to .env files',
		pattern: '(?:^|[\\\\/])\\.env(?:\\.[A-Za-z0-9_-]+)*$',
		tools: ['Grep'],
		targetField: 'path',
		caseInsensitive: true,
	},
	{
		id: 'env-bash-read',
		description: 'Block reading .env files via bash',
		pattern:
			'\\b(cat|head|tail|less|more|bat|view)\\b[^\\n|;]*' +
			'(?:^|[^A-Za-z0-9_])\\.env(?:\\.[A-Za-z0-9_-]+)*(?:$|[^A-Za-z0-9_])',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'env-bash-source',
		description: 'Block sourcing .env files',
		pattern:
			'(?:\\bsource\\b|\\.)\\s+[^\\n|;]*' +
			'(?:^|[^A-Za-z0-9_])\\.env(?:\\.[A-Za-z0-9_-]+)*(?:$|[^A-Za-z0-9_])',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'env-bash-grep',
		description: 'Block grep/search in .env files',
		pattern:
			'\\b(grep|awk|sed)\\b[^\\n|;]*' +
			'(?:^|[^A-Za-z0-9_])\\.env(?:\\.[A-Za-z0-9_-]+)*(?:$|[^A-Za-z0-9_])',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'env-bash-glob-patterns',
		description: 'Block shell glob patterns that can expand to .env files',
		pattern: '(\\.en(?:\\*|\\?|\\[[^\\]]+\\]))|(\\.env(?:\\*|\\?))|(\\.e\\[[^\\]]+\\]v)',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'env-bash-escaped-env-reference',
		description: 'Block escaped shell references to .env files',
		pattern: '(\\.\\\\x65nv)|(\\\\x2eenv)|(\\\\056env)|(\\\\u0*02eenv)',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'env-bash-printenv',
		description: 'Block printenv usage (env var exfiltration)',
		pattern: '(^|[;|&()\\s])printenv(\\s|$)',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'env-bash-env-dump',
		description: 'Block standalone env dumps via env command',
		pattern: '(^|[;|&()\\s])env(\\s*(\\||;|&&|\\|\\||$))',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'env-bash-runtime-env-access',
		description: 'Block runtime script snippets that read process environment',
		pattern:
			'\\b(node|bun|deno|python|python3|ruby|perl)\\b[^\\n|;]*' +
			'(process\\.env\\b|os\\.environ\\b|os\\.getenv\\b|%ENV\\b|\\bENV\\s*\\[)',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
	{
		id: 'env-bash-any-env-reference',
		description: 'Block any Bash command that references .env files',
		pattern:
			'(^|[^A-Za-z0-9_])(?:[.~\\\\/A-Za-z0-9_${}-]*[\\\\/])?' +
			'\\.env(?:\\.[A-Za-z0-9_-]+)*(?:$|[^A-Za-z0-9_])',
		tools: ['Bash'],
		targetField: 'command',
		caseInsensitive: true,
	},
];

// =============================================================================
// Content Filter Implementation
// =============================================================================

/**
 * Built-in rules are curated and tested locally. User-provided rules pass
 * through safe-regex2 first so public n8n installs do not need native RE2.
 */
const BUILT_IN_CONTENT_FILTER_RULES = new WeakSet<ContentBlockRule>([
	...DANGEROUS_COMMANDS_PRESET,
	...SECRETS_PATTERNS_PRESET,
	...SYSTEM_FILES_PRESET,
	...ENV_FILE_PROTECTION_RULES,
]);
const SAFE_REGEX_REPETITION_LIMIT = 100;

type PatternCheckResult =
	| { status: 'match'; matchedContent: string }
	| { status: 'no-match' }
	| { status: 'unsafe'; reason: string };

function checkPattern(
	pattern: string,
	content: string,
	caseInsensitive?: boolean,
	trustedPattern = false,
): PatternCheckResult {
	if (!trustedPattern && !safeRegex(pattern, { limit: SAFE_REGEX_REPETITION_LIMIT })) {
		return {
			status: 'unsafe',
			reason: `Unsafe regex pattern rejected before evaluation: ${pattern}`,
		};
	}

	try {
		const regex = new RegExp(pattern, caseInsensitive ? 'i' : undefined);
		const match = regex.exec(content);

		if (!match) {
			return { status: 'no-match' };
		}

		return {
			status: 'match',
			matchedContent: match[0].length > 100 ? match[0].substring(0, 100) + '...' : match[0],
		};
	} catch {
		// Invalid patterns are treated as non-matching, matching the previous behavior.
		console.warn(`Invalid or unsupported regex pattern: ${pattern}`);
		return { status: 'no-match' };
	}
}

/**
 * Normalize a shell command by parsing it and extracting actual command tokens.
 * This defeats bypass attempts using quotes, escapes, backticks, and variable expansion.
 */
function normalizeShellCommand(command: string): string {
	try {
		const parsed = parseShell(command);
		// Extract string tokens and operators
		const normalized: string[] = [];

		for (const token of parsed) {
			if (typeof token === 'string') {
				// Strip command substitution/backtick markers so disguised commands are exposed
				const cleaned = token
					.replace(/`/g, '')
					// Preserve command-substitution payload so nested env reads remain detectable.
					.replace(/\$\(([^)]*)\)/g, ' $1 ')
					.replace(/\$/g, '');
				if (cleaned.length > 0) {
					normalized.push(cleaned);
				}
			} else if (typeof token === 'object' && token !== null) {
				// Handle operators and special tokens
				if ('op' in token) {
					// shell-quote glob token includes both op='glob' and pattern; preserve pattern.
					if (token.op === 'glob' && 'pattern' in token) {
						normalized.push(String(token.pattern));
						continue;
					}
					// Operators like |, ;, &&, ||
					if (token.op === '(' || token.op === ')') {
						continue; // Skip lone parentheses from substitutions
					}
					normalized.push(token.op);
				} else if ('pattern' in token) {
					// Glob patterns
					normalized.push(String(token.pattern));
				}
				// Command substitution $(cmd) or `cmd` - the inner command is also parsed
			}
		}

		const spaced = normalized.join(' ').trim();
		const compact = normalized.join('').replace(/\s+/g, '').replace(/`/g, '');
		// Insert a separator before the first flag so patterns like rm-rf are caught
		const compactWithSpacing = compact.replace(/^([A-Za-z0-9._]+)(-)/, '$1 $2');

		return [spaced, compactWithSpacing].filter(Boolean).join(' ').trim();
	} catch {
		// If parsing fails, return original
		return command;
	}
}

/**
 * Extract content from tool input for a specific target field.
 * For Bash commands, normalizes the command to defeat bypass attempts.
 */
function extractContent(
	toolName: string,
	toolInput: Record<string, unknown>,
	targetField: ContentFilterTarget,
): string | undefined {
	const value = toolInput[targetField];
	if (typeof value !== 'string') {
		return undefined;
	}

	// For Bash commands, normalize to defeat bypass attempts
	if (toolName === 'Bash' && targetField === 'command') {
		return normalizeShellCommand(value);
	}

	return value;
}

/**
 * Check if a single rule matches the tool input
 */
function checkRule(
	toolName: string,
	toolInput: Record<string, unknown>,
	rule: ContentBlockRule,
): { matches: boolean; matchedContent?: string } {
	// Check if the rule applies to this tool
	if (!rule.tools.includes(toolName as ContentFilterTool)) {
		return { matches: false };
	}

	// Get the content to check (with shell normalization for Bash)
	const content = extractContent(toolName, toolInput, rule.targetField);
	if (!content) {
		return { matches: false };
	}

	const patternResult = checkPattern(
		rule.pattern,
		content,
		rule.caseInsensitive,
		BUILT_IN_CONTENT_FILTER_RULES.has(rule),
	);
	if (patternResult.status === 'unsafe') {
		return {
			matches: true,
			matchedContent: patternResult.reason,
		};
	}

	if (patternResult.status === 'match') {
		return {
			matches: true,
			matchedContent: patternResult.matchedContent,
		};
	}

	return { matches: false };
}

/**
 * Get all rules including presets
 */
function getAllRules(config: ContentFilterConfig): ContentBlockRule[] {
	const rules: ContentBlockRule[] = [...config.rules];

	if (config.presets) {
		for (const preset of config.presets) {
			const presetRules = PRESETS[preset];
			if (presetRules) {
				rules.push(...presetRules);
			}
		}
	}

	return rules;
}

/**
 * Check if a tool use should be blocked by content filtering
 */
export function checkContentFilter(
	input: PreToolUseHookInput,
	config: ContentFilterConfig,
): ContentFilterResult {
	const rules = getAllRules(config);

	for (const rule of rules) {
		const result = checkRule(input.tool_name, input.tool_input, rule);

		if (result.matches) {
			return {
				blocked: true,
				reason: rule.description || `Blocked by content filter rule: ${rule.id}`,
				matchedRule: rule.id,
				matchedContent: result.matchedContent,
			};
		}
	}

	return { blocked: false };
}
