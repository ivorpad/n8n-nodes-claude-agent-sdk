import { describe, expect, it } from 'vitest';

import {
	mapQuestionsToFormFields,
	parseQuestionAnswers,
	parseQuestionSubmission,
} from '../../webhook/questionForm';

describe('questionForm', () => {
	it('maps options to labels without descriptions', () => {
		const fields = mapQuestionsToFormFields([
			{
				question: 'Format output?',
				header: 'Formatting',
				options: [
					{ label: 'Summary', description: 'Short answer' },
					{ label: 'Detailed', description: 'Long answer' },
				],
				multiSelect: false,
			},
		]);

			expect(fields[0]?.options).toEqual([
				{ label: 'Summary', value: 'Summary', action: undefined },
				{ label: 'Detailed', value: 'Detailed', action: undefined },
			]);
		});

	it('maps internal option values back to labels when parsing form answers', () => {
		const answers = parseQuestionAnswers(
			{
				'field-0': JSON.stringify(['q0o1']),
			},
			[
				{
					question: 'Final review?',
					header: 'Review',
					options: [
						{ label: 'Modify', description: '', value: 'q0o0', action: 'resume' },
						{ label: 'Looks good', description: '', value: 'q0o1', action: 'complete' },
					],
					multiSelect: false,
				},
			],
		);

		expect(answers).toEqual({
			Review: 'Looks good',
		});
	});

	it('parses answers keyed by question text and joins multi-select labels', () => {
		const answers = parseQuestionAnswers(
			{
				'field-0': JSON.stringify(['Summary']),
				'field-1': JSON.stringify(['Introduction', 'Conclusion']),
				'field-2': 'Use markdown',
			},
			[
				{
					question: 'How should I format the output?',
					header: 'Formatting',
					options: [{ label: 'Summary', description: '' }],
					multiSelect: false,
				},
				{
					question: 'Which sections should I include?',
					header: 'Sections',
					options: [
						{ label: 'Introduction', description: '' },
						{ label: 'Conclusion', description: '' },
					],
					multiSelect: true,
				},
				{
					question: 'Any extra instructions?',
					header: 'Notes',
					options: [],
					multiSelect: false,
				},
			],
		);

		expect(answers).toEqual({
			'Formatting': 'Summary',
			'Sections': 'Introduction, Conclusion',
			'Notes': 'Use markdown',
		});
	});

	it('parses named field keys keyed by question header for compatibility', () => {
		const answers = parseQuestionAnswers(
			{
				'field-Revisión': JSON.stringify(['Está bien']),
				'field-Lineamientos': 'Sin lineamientos adicionales',
			},
			[
				{
					question: '¿La guía está lista?',
					header: 'Revisión',
					options: [
						{ label: 'Está bien', description: '' },
						{ label: 'Modificar', description: '' },
					],
					multiSelect: false,
				},
				{
					question: '¿Tienes lineamientos adicionales?',
					header: 'Lineamientos',
					options: [],
					multiSelect: false,
				},
			],
		);

		expect(answers).toEqual({
			'Revisión': 'Está bien',
			'Lineamientos': 'Sin lineamientos adicionales',
		});
	});

	it('omits empty/missing answers instead of emitting blank placeholders', () => {
		const answers = parseQuestionAnswers(
			{
				'field-0': JSON.stringify([]),
				'field-2': '   ',
			},
			[
				{
					question: 'Pick one option',
					header: 'Choice',
					options: [{ label: 'Summary', description: '' }],
					multiSelect: false,
				},
				{
					question: 'Multi-select',
					header: 'Sections',
					options: [{ label: 'Intro', description: '' }],
					multiSelect: true,
				},
				{
					question: 'Free text',
					header: 'Notes',
					options: [],
					multiSelect: false,
				},
			],
		);

		expect(answers).toEqual({});
	});

	it('derives responseAction=complete from selected terminal option', () => {
		const parsed = parseQuestionSubmission(
			{
				'field-0': JSON.stringify(['q0o1']),
			},
			[
				{
					question: 'Final review?',
					header: 'Review',
					options: [
						{ label: 'Modify', description: '', value: 'q0o0', action: 'resume' },
						{ label: 'Looks good', description: '', value: 'q0o1', action: 'complete' },
					],
					multiSelect: false,
				},
			],
		);

		expect(parsed.answers).toEqual({ Review: 'Looks good' });
		expect(parsed.responseAction).toBe('complete');
	});

	it('defaults responseAction=resume for free-text submissions', () => {
		const parsed = parseQuestionSubmission(
			{
				'field-0': 'Use markdown',
			},
			[
				{
					question: 'Any extra instructions?',
					header: 'Notes',
					options: [],
					multiSelect: false,
				},
			],
		);

		expect(parsed.answers).toEqual({ Notes: 'Use markdown' });
		expect(parsed.responseAction).toBe('resume');
	});

	it('treats free-text sentinel options as a textarea field', () => {
		const fields = mapQuestionsToFormFields([
			{
				question: 'Enter the 6-digit OTP.',
				header: 'OTP',
				options: [
					{ label: 'Free text', description: '', value: '__free_text__' },
					{ label: 'Free text alt', description: '', value: '__free_text_alt__' },
				],
				multiSelect: false,
			},
		]);

		expect(fields[0]).toEqual({
			id: 'field-0',
			label: 'OTP: Enter the 6-digit OTP.',
			required: true,
			type: 'textarea',
		});
	});

	it('parses free-text sentinel submissions as raw text answers', () => {
		const answers = parseQuestionAnswers(
			{
				'field-0': '613056',
			},
			[
				{
					question: 'Enter the 6-digit OTP.',
					header: 'OTP',
					options: [
						{ label: 'Free text', description: '', value: '__free_text__' },
						{ label: 'Free text alt', description: '', value: '__free_text_alt__' },
					],
					multiSelect: false,
				},
			],
		);

		expect(answers).toEqual({
			OTP: '613056',
		});
	});
});
