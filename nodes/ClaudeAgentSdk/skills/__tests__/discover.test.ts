import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { discoverSkills, scanSkillsDirectory, parseFrontmatter, parseSkillDocument } from '../discover';

// Temp directory for test fixtures
let tmpDir: string;

function userSkillsDirectory(): string {
	return path.join(tmpDir, 'user-skills');
}

beforeEach(async () => {
	tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'skill-discover-'));
});

afterEach(async () => {
	await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ── parseFrontmatter ──────────────────────────────────────────────

describe('parseFrontmatter', () => {
	it('extracts name and description from valid frontmatter', () => {
		const content = `---
name: pdf-processing
description: Extract and process PDF documents
---
# PDF Processing Skill`;

		expect(parseFrontmatter(content)).toEqual({
			name: 'pdf-processing',
			description: 'Extract and process PDF documents',
		});
	});

	it('returns empty object when no frontmatter present', () => {
		expect(parseFrontmatter('# Just a heading\nSome content')).toEqual({});
	});

	it('handles frontmatter with only name', () => {
		const content = `---
name: my-skill
---
Content`;

		expect(parseFrontmatter(content)).toEqual({
			name: 'my-skill',
			description: undefined,
		});
	});

	it('handles frontmatter with only description', () => {
		const content = `---
description: Some description
---
Content`;

		expect(parseFrontmatter(content)).toEqual({
			name: undefined,
			description: 'Some description',
		});
	});

	it('trims whitespace from values', () => {
		const content = `---
name:   spaced-name
description:   spaced description
---`;

		expect(parseFrontmatter(content)).toEqual({
			name: 'spaced-name',
			description: 'spaced description',
		});
	});

	it('handles Windows-style line endings', () => {
		const content = '---\r\nname: win-skill\r\ndescription: Windows skill\r\n---\r\nContent';

		expect(parseFrontmatter(content)).toEqual({
			name: 'win-skill',
			description: 'Windows skill',
		});
	});

	it('ignores extra YAML fields', () => {
		const content = `---
name: my-skill
version: 1.0
description: A skill
author: test
---`;

		expect(parseFrontmatter(content)).toEqual({
			name: 'my-skill',
			description: 'A skill',
		});
	});
});

describe('parseSkillDocument', () => {
	it('extracts body and supports folded multiline description', () => {
		const content = `---
name: content-design
description: >
	First line
	second line
allowed-tools: Read,Edit
---
# Instructions
Use this skill for writing.\n`;

		const parsed = parseSkillDocument(content);
		expect(parsed.name).toBe('content-design');
		expect(parsed.description).toBe('First line second line');
		expect(parsed.frontmatter['allowed-tools']).toBe('Read,Edit');
		expect(parsed.body).toBe('# Instructions\nUse this skill for writing.');
	});

	it('returns full content as body when frontmatter is missing', () => {
		const parsed = parseSkillDocument('# Heading\nBody text');
		expect(parsed.frontmatter).toEqual({});
		expect(parsed.body).toBe('# Heading\nBody text');
	});
});

// ── scanSkillsDirectory ───────────────────────────────────────────

describe('scanSkillsDirectory', () => {
	it('discovers skills with valid SKILL.md', async () => {
		const skillDir = path.join(tmpDir, 'test-skill');
		await fs.promises.mkdir(skillDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(skillDir, 'SKILL.md'),
			'---\nname: test-skill\ndescription: A test skill\n---\nContent',
		);

		const skills = await scanSkillsDirectory(tmpDir, 'project');

		expect(skills).toHaveLength(1);
		expect(skills[0]).toEqual({
			name: 'test-skill',
			description: 'A test skill',
			source: 'project',
			path: path.join(skillDir, 'SKILL.md'),
		});
	});

	it('uses directory name as fallback when name is missing from frontmatter', async () => {
		const skillDir = path.join(tmpDir, 'my-cool-skill');
		await fs.promises.mkdir(skillDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(skillDir, 'SKILL.md'),
			'---\ndescription: No name field\n---\nContent',
		);

		const skills = await scanSkillsDirectory(tmpDir, 'user');

		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe('my-cool-skill');
		expect(skills[0].description).toBe('No name field');
		expect(skills[0].source).toBe('user');
	});

	it('skips directories without SKILL.md', async () => {
		const skillDir = path.join(tmpDir, 'empty-skill');
		await fs.promises.mkdir(skillDir, { recursive: true });
		// No SKILL.md created

		const skills = await scanSkillsDirectory(tmpDir, 'project');
		expect(skills).toHaveLength(0);
	});

	it('skips files (non-directories) in skills folder', async () => {
		await fs.promises.writeFile(path.join(tmpDir, 'not-a-dir.txt'), 'hello');

		const skills = await scanSkillsDirectory(tmpDir, 'project');
		expect(skills).toHaveLength(0);
	});

	it('returns empty array for non-existent directory', async () => {
		const skills = await scanSkillsDirectory('/nonexistent/path/skills', 'project');
		expect(skills).toHaveLength(0);
	});

	it('handles SKILL.md without frontmatter', async () => {
		const skillDir = path.join(tmpDir, 'no-frontmatter');
		await fs.promises.mkdir(skillDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(skillDir, 'SKILL.md'),
			'# Just a heading\nNo frontmatter here',
		);

		const skills = await scanSkillsDirectory(tmpDir, 'project');

		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe('no-frontmatter'); // Falls back to dir name
		expect(skills[0].description).toBe('');
	});

	it('discovers multiple skills', async () => {
		for (const name of ['alpha', 'beta', 'gamma']) {
			const dir = path.join(tmpDir, name);
			await fs.promises.mkdir(dir, { recursive: true });
			await fs.promises.writeFile(
				path.join(dir, 'SKILL.md'),
				`---\nname: ${name}\ndescription: ${name} skill\n---\n`,
			);
		}

		const skills = await scanSkillsDirectory(tmpDir, 'project');
		expect(skills).toHaveLength(3);
		expect(skills.map((s) => s.name).sort()).toEqual(['alpha', 'beta', 'gamma']);
	});
});

// ── discoverSkills (integration) ──────────────────────────────────

describe('discoverSkills', () => {
	it('deduplicates: project skills override user skills with same name', async () => {
		const projectDir = path.join(tmpDir, 'project');
		const projectSkillsDir = path.join(projectDir, '.claude', 'skills', 'shared');
		await fs.promises.mkdir(projectSkillsDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(projectSkillsDir, 'SKILL.md'),
			'---\nname: shared\ndescription: Project version\n---\n',
		);

		const userSkillsDir = path.join(userSkillsDirectory(), 'shared');
		await fs.promises.mkdir(userSkillsDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(userSkillsDir, 'SKILL.md'),
			'---\nname: shared\ndescription: User version\n---\n',
		);

		const skills = await discoverSkills(projectDir, {
			userSkillsDirectory: userSkillsDirectory(),
		});

		expect(skills).toEqual([
			expect.objectContaining({
				name: 'shared',
				description: 'Project version',
				source: 'project',
			}),
		]);
	});

	it('returns empty array when no working directory and no user skills', async () => {
		const skills = await discoverSkills('/nonexistent/project', {
			userSkillsDirectory: userSkillsDirectory(),
		});

		expect(skills).toEqual([]);
	});

	it('returns only user skills when no working directory provided', async () => {
		const userSkillsDir = path.join(userSkillsDirectory(), 'user-only');
		await fs.promises.mkdir(userSkillsDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(userSkillsDir, 'SKILL.md'),
			'---\nname: user-only\ndescription: User scope\n---\n',
		);

		const skills = await discoverSkills(undefined, {
			userSkillsDirectory: userSkillsDirectory(),
		});

		expect(skills).toEqual([
			expect.objectContaining({
				name: 'user-only',
				description: 'User scope',
				source: 'user',
			}),
		]);
	});

	it('excludes user skills when includeUserSkills is false', async () => {
		// Project skill present under tmpDir; user scope (~/.claude/skills) is skipped
		// entirely, so the result is deterministic regardless of the host machine.
		const projectSkillsDir = path.join(tmpDir, '.claude', 'skills', 'proj-only');
		await fs.promises.mkdir(projectSkillsDir, { recursive: true });
		await fs.promises.writeFile(
			path.join(projectSkillsDir, 'SKILL.md'),
			'---\nname: proj-only\ndescription: Project scope\n---\n',
		);

		const skills = await discoverSkills(tmpDir, { includeUserSkills: false });

		expect(skills).toEqual([
			expect.objectContaining({ name: 'proj-only', source: 'project' }),
		]);
		expect(skills.every((s) => s.source === 'project')).toBe(true);
	});

	it('returns empty when includeUserSkills is false and no working directory', async () => {
		const skills = await discoverSkills(undefined, { includeUserSkills: false });
		expect(skills).toEqual([]);
	});
});
