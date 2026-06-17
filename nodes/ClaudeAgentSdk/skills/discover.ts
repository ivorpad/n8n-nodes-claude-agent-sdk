/**
 * Skill Discovery
 *
 * Scans `.claude/skills/` directories for SKILL.md files and extracts metadata.
 * Used by the node's `methods.loadOptions` to populate an informational dropdown.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface DiscoveredSkill {
	name: string;
	description: string;
	source: 'project' | 'user';
	path: string;
}

interface ParsedSkillDocument {
	frontmatter: Record<string, string>;
	body: string;
	name?: string;
	description?: string;
}

interface SkillDiscoveryOptions {
	includeUserSkills?: boolean;
	userSkillsDirectory?: string;
}

/**
 * Discover skills from project and user-level `.claude/skills/` directories.
 *
 * Project skills (from `workingDirectory/.claude/skills/`) take precedence
 * over user skills (`~/.claude/skills/`) when names collide.
 *
 * `options.includeUserSkills` (default `true`) controls whether the user-level
 * `~/.claude/skills/` directory is scanned at all. Pass `false` to restrict
 * discovery to the project's skills only.
 */
export async function discoverSkills(
	workingDirectory?: string,
	options?: SkillDiscoveryOptions,
): Promise<DiscoveredSkill[]> {
	const projectSkills = workingDirectory
		? await scanSkillsDirectory(path.join(workingDirectory, '.claude', 'skills'), 'project')
		: [];

	const includeUserSkills = options?.includeUserSkills ?? true;
	const userSkillsDirectory = options?.userSkillsDirectory
		?? path.join(os.homedir(), '.claude', 'skills');
	const userSkills = includeUserSkills
		? await scanSkillsDirectory(userSkillsDirectory, 'user')
		: [];

	// Deduplicate: project skills win over user skills
	const seen = new Set(projectSkills.map((s) => s.name));
	const deduped = [...projectSkills];
	for (const skill of userSkills) {
		if (!seen.has(skill.name)) {
			seen.add(skill.name);
			deduped.push(skill);
		}
	}

	return deduped;
}

/**
 * Scan a single `.claude/skills/` directory for subdirectories containing SKILL.md.
 */
export async function scanSkillsDirectory(
	dir: string,
	source: 'project' | 'user',
): Promise<DiscoveredSkill[]> {
	const skills: DiscoveredSkill[] = [];

	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		// Directory doesn't exist or isn't readable
		return skills;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
		let content: string;
		try {
			content = await fs.promises.readFile(skillMdPath, 'utf-8');
		} catch {
			// No SKILL.md in this subdirectory
			continue;
		}

		const parsed = parseSkillDocument(content);
		skills.push({
			name: parsed.name || entry.name,
			description: parsed.description || '',
			source,
			path: skillMdPath,
		});
	}

	return skills;
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 *
 * Extracts single-line `name:` and `description:` values from a
 * `---` delimited frontmatter block. No external YAML dependency needed.
 */
export function parseFrontmatter(content: string): { name?: string; description?: string } {
	const parsed = parseSkillDocument(content);
	return {
		name: parsed.name,
		description: parsed.description,
	};
}

function stripQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"'))
		|| (value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function normalizeBlockLines(lines: string[]): string[] {
	const nonEmpty = lines.filter((line) => line.trim().length > 0);
	if (nonEmpty.length === 0) return lines;

	const minIndent = nonEmpty.reduce((min, line) => {
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		return Math.min(min, indent);
	}, Number.POSITIVE_INFINITY);

	return lines.map((line) => line.slice(Math.min(minIndent, line.length)));
}

function parseYamlFrontmatterBlock(block: string): Record<string, string> {
	const result: Record<string, string> = {};
	const lines = block.replace(/\r\n/g, '\n').split('\n');

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
			continue;
		}

		const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
		if (!keyMatch) {
			continue;
		}

		const key = keyMatch[1];
		const rawValue = keyMatch[2].trim();
		if (rawValue === '|' || rawValue === '>') {
			const blockLines: string[] = [];
			for (index += 1; index < lines.length; index += 1) {
				const candidate = lines[index];
				if (candidate.trim().length === 0) {
					blockLines.push('');
					continue;
				}
				if (!/^\s/.test(candidate)) {
					index -= 1;
					break;
				}
				blockLines.push(candidate);
			}

			const normalized = normalizeBlockLines(blockLines).map((entry) => entry.trimEnd());
			if (rawValue === '|') {
				result[key] = normalized.join('\n').trim();
			} else {
				const folded = normalized.reduce((acc, entry) => {
					if (entry.trim().length === 0) {
						return `${acc}\n`;
					}
					if (acc.length === 0 || acc.endsWith('\n')) {
						return `${acc}${entry.trim()}`;
					}
					return `${acc} ${entry.trim()}`;
				}, '');
				result[key] = folded.trim();
			}
			continue;
		}

		result[key] = stripQuotes(rawValue).trim();
	}

	return result;
}

export function parseSkillDocument(content: string): ParsedSkillDocument {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) {
		return {
			frontmatter: {},
			body: content.trim(),
		};
	}

	const frontmatter = parseYamlFrontmatterBlock(match[1]);
	const body = content.slice(match[0].length).trim();
	const name = frontmatter.name;
	const description = frontmatter.description;

	return {
		frontmatter,
		body,
		name,
		description,
	};
}
