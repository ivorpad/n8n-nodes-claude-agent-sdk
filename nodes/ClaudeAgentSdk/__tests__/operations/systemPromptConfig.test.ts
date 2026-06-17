import { describe, expect, it } from 'vitest';

import { buildSystemPromptConfig } from '../../operations/executeTask/config';

describe('buildSystemPromptConfig', () => {
	it('uses the full Claude Code preset when no prompt sections are selected', () => {
		expect(
			buildSystemPromptConfig(
				['project', 'user'],
				'Add workflow-specific instructions.',
				'Subagent guidance.',
				true,
				[],
				{
					allowedTools: ['Read', 'Edit', 'Write', 'Bash'],
					settingSources: ['project', 'user'],
				},
			),
		).toEqual({
			type: 'preset',
			preset: 'claude_code',
			append: 'Add workflow-specific instructions.\n\nSubagent guidance.',
		});
	});

	it('builds a cherry-picked Claude Code prompt when sections are selected', () => {
		const result = buildSystemPromptConfig(
			['project'],
			'Project-specific instructions.',
			'Structured output hint.',
			true,
			['usingTools', 'sessionGuidance'],
			{
				allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Skill', 'AskUserQuestion', 'Task', 'TodoWrite'],
				settingSources: ['project'],
			},
		);

		expect(typeof result).toBe('string');
		expect(result).toContain('# Using your tools');
		expect(result).toContain('# Session guidance');
		expect(result).toContain('Use Read instead of shelling out');
		expect(result).toContain('prefer Skill instead of recreating the workflow');
		expect(result).toContain('Project-specific instructions.');
		expect(result).toContain('Structured output hint.');
	});

	it('keeps prompt-section mode available when the full preset is disabled', () => {
		const result = buildSystemPromptConfig(
			[],
			'Act as a support assistant.',
			'',
			false,
			['system', 'toneStyle'],
			{
				allowedTools: ['Read'],
				settingSources: [],
			},
		);

		expect(typeof result).toBe('string');
		expect(result).toContain('# System');
		expect(result).toContain('# Tone and style');
		expect(result).toContain('Act as a support assistant.');
	});
});
