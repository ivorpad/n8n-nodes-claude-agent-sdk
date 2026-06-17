/**
 * Path Sandboxing
 *
 * Validates that file operations stay within allowed directories.
 * Blocks and errors when paths are outside the sandbox (no silent rewrites).
 *
 * Security: Sanitizes paths to handle URL encoding, null bytes, and traversal attempts.
 * Also resolves symlinks to prevent bypass via symlink attacks.
 */

import * as path from 'path';
import { realpathSync, existsSync } from 'fs';
import sanitizePath from 'path-sanitizer';
import type {
	PathSandboxConfig,
	PathValidationResult,
	PreToolUseHookInput,
	PathAffectedTool,
} from './types';

// Map tool names to their path-containing input fields
const TOOL_PATH_FIELDS: Record<PathAffectedTool, string[]> = {
	Read: ['file_path'],
	Write: ['file_path'],
	Edit: ['file_path'],
	Glob: ['path', 'pattern'], // pattern may contain path
	Grep: ['path'],
};

/**
 * Extract path(s) from tool input based on tool type
 */
function extractPaths(toolName: string, toolInput: Record<string, unknown>, cwd: string): string[] {
	const affectedTool = toolName as PathAffectedTool;
	const fields = TOOL_PATH_FIELDS[affectedTool];

	if (!fields) {
		return [];
	}

	const paths: string[] = [];

	for (const field of fields) {
		const value = toolInput[field];
		if (typeof value === 'string' && value.length > 0) {
			// For Glob pattern, resolve relative patterns against cwd
			// instead of skipping them. This prevents traversal bypasses like '../**/*'.
			const candidate = field === 'pattern' && !path.isAbsolute(value)
				? path.join(cwd, value)
				: value;

			if (field === 'pattern' && candidate.length === 0) {
				continue;
			}
			paths.push(candidate);
		}
	}

	return paths;
}

/**
 * Sanitize a path to handle URL encoding, null bytes, and other bypass attempts.
 * This handles:
 * - URL encoding (%2e%2e -> ..)
 * - Double URL encoding (%252e -> %2e -> .)
 * - Null bytes (\x00)
 * - Path traversal sequences (../, ..\)
 */
function sanitizeInputPath(inputPath: string): { cleaned: string; sanitized: string; isAbsoluteInput: boolean } {
	const isAbsoluteInput = path.isAbsolute(inputPath);

	// First, decode URL encoding (handles double encoding too)
	let decoded = inputPath;
	let prevDecoded = '';

	// Keep decoding until stable (handles double/triple encoding)
	while (decoded !== prevDecoded) {
		prevDecoded = decoded;
		try {
			decoded = decodeURIComponent(decoded);
		} catch {
			// Invalid encoding, stop decoding
			break;
		}
	}

	// Remove null bytes
	decoded = decoded.split('\u0000').join('');

	// Use path-sanitizer for additional safety
	const sanitizedRaw = sanitizePath(decoded);
	const sanitized = isAbsoluteInput && !sanitizedRaw.startsWith(path.sep)
		? path.join(path.sep, sanitizedRaw)
		: sanitizedRaw;

	return { cleaned: decoded, sanitized, isAbsoluteInput };
}

/**
 * Normalize and resolve a path, handling relative paths.
 * Returns both the decoded path (for validation) and sanitized path (for logging).
 */
function resolvePath(inputPath: string, cwd: string): { resolvedOriginal: string; resolvedSanitized: string } {
	const { cleaned, sanitized, isAbsoluteInput } = sanitizeInputPath(inputPath);

	const resolvedOriginal = path.normalize(
		isAbsoluteInput ? cleaned : path.join(cwd, cleaned),
	);

	const resolvedSanitized = path.normalize(
		path.isAbsolute(sanitized) ? sanitized : path.join(cwd, sanitized),
	);

	return { resolvedOriginal, resolvedSanitized };
}

/**
 * Check if a path is within the sandbox or allowed paths
 */
function isPathAllowed(
	resolvedPath: string,
	config: PathSandboxConfig,
): boolean {
	const normalizedBase = canonicalizeConfiguredPath(config.basePath);

	// Check if path is within the base sandbox path
	if (resolvedPath.startsWith(normalizedBase + path.sep) || resolvedPath === normalizedBase) {
		return true;
	}

	// Check additional allowed paths
	if (config.allowedPaths) {
		for (const allowedPath of config.allowedPaths) {
			const normalizedAllowed = canonicalizeConfiguredPath(allowedPath);
			if (
				resolvedPath.startsWith(normalizedAllowed + path.sep) ||
				resolvedPath === normalizedAllowed
			) {
				return true;
			}
		}
	}

	return false;
}

/**
 * Check if a path is within any explicit allowed path list.
 */
function isPathWithinAllowlist(resolvedPath: string, allowlist: string[]): boolean {
	for (const allowedPath of allowlist) {
		const normalizedAllowed = canonicalizeConfiguredPath(allowedPath);
		if (
			resolvedPath.startsWith(normalizedAllowed + path.sep) ||
			resolvedPath === normalizedAllowed
		) {
			return true;
		}
	}
	return false;
}

function canonicalizeConfiguredPath(configPath: string): string {
	return path.normalize(resolveSymlinksForPotentiallyNewPath(path.resolve(configPath)));
}

function resolveSymlinksForPotentiallyNewPath(resolvedPath: string): string {
	const missingSegments: string[] = [];
	let existingAncestor = resolvedPath;

	while (!existsSync(existingAncestor)) {
		const parent = path.dirname(existingAncestor);
		if (parent === existingAncestor) {
			break;
		}
		missingSegments.unshift(path.basename(existingAncestor));
		existingAncestor = parent;
	}

	try {
		const realAncestor = existsSync(existingAncestor)
			? realpathSync(existingAncestor)
			: existingAncestor;
		return missingSegments.length > 0
			? path.join(realAncestor, ...missingSegments)
			: realAncestor;
	} catch {
		return resolvedPath;
	}
}

/**
 * Validate a single path against the sandbox configuration
 *
 * Security: Resolves symlinks to prevent bypass attacks where a symlink
 * inside the sandbox points to a location outside the sandbox.
 */
export function validatePath(
	inputPath: string,
	cwd: string,
	config: PathSandboxConfig,
): PathValidationResult {
	const { resolvedOriginal } = resolvePath(inputPath, cwd);

	// Resolve existing symlink ancestors as well as existing full paths. New files
	// under a symlinked directory must be checked against the symlink target.
	const realPath = resolveSymlinksForPotentiallyNewPath(resolvedOriginal);

	if (isPathAllowed(realPath, config)) {
		if (
			config.operatorAllowedPaths?.length
			&& !isPathWithinAllowlist(realPath, config.operatorAllowedPaths)
		) {
			return {
				valid: false,
				originalPath: inputPath,
				resolvedPath: resolvedOriginal,
				error: `Path "${inputPath}" (resolved: ${resolvedOriginal}) is outside operator-enforced allowed paths. ` +
					`Allowed by operator: ${config.operatorAllowedPaths.join(', ')}`,
			};
		}

		return {
			valid: true,
			originalPath: inputPath,
			resolvedPath: resolvedOriginal,
		};
	}

	return {
		valid: false,
		originalPath: inputPath,
		resolvedPath: resolvedOriginal,
		error: `Path "${inputPath}" (resolved: ${resolvedOriginal}) is outside the allowed sandbox. ` +
			`Allowed: ${config.basePath}${config.allowedPaths?.length ? `, ${config.allowedPaths.join(', ')}` : ''}`,
	};
}

/**
 * Check if a tool use is allowed by the path sandbox
 */
export function checkPathSandbox(
	input: PreToolUseHookInput,
	config: PathSandboxConfig,
): PathValidationResult {
	// Check if this tool is affected by path sandboxing
	if (!config.affectedTools.includes(input.tool_name as PathAffectedTool)) {
		return { valid: true, originalPath: '' };
	}

	// Extract paths from tool input
	const paths = extractPaths(input.tool_name, input.tool_input, input.cwd || '.');

	if (paths.length === 0) {
		// No paths to check (might be a relative glob pattern)
		return { valid: true, originalPath: '' };
	}

	// Validate each path
	for (const inputPath of paths) {
		const result = validatePath(inputPath, input.cwd || '.', config);
		if (!result.valid) {
			return result;
		}
	}

	return { valid: true, originalPath: paths[0] || '' };
}
