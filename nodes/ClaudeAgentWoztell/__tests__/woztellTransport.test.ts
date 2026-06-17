import { describe, expect, it } from 'vitest';

import {
	buildListPayload,
	buildReplyButtonsPayload,
	buildTemplatePayload,
	buildTextPayload,
} from '../transport/woztell';

describe('Woztell HITL transport payload builders', () => {
	describe('buildTextPayload', () => {
		it('builds a TEXT payload', () => {
			const result = buildTextPayload('Hello world');
			expect(result).toEqual({ type: 'TEXT', text: 'Hello world' });
		});
	});

	describe('buildReplyButtonsPayload', () => {
		it('builds WHATSAPP_REPLY_BUTTONS payload with correct structure', () => {
			const result = buildReplyButtonsPayload('Pick one:', [
				{ payload: 'hitl|approve|req123', title: 'Approve' },
				{ payload: 'hitl|deny|req123', title: 'Deny' },
			]);

			expect(result).toEqual({
				type: 'WHATSAPP_REPLY_BUTTONS',
				body: { text: 'Pick one:' },
				action: {
					buttons: [
						{
							type: 'reply',
							reply: { payload: 'hitl|approve|req123', title: 'Approve' },
						},
						{
							type: 'reply',
							reply: { payload: 'hitl|deny|req123', title: 'Deny' },
						},
					],
				},
			});
		});

		it('truncates button titles to 20 characters', () => {
			const result = buildReplyButtonsPayload('Choose:', [
				{ payload: 'id1', title: 'This is a very long button title' },
			]);

			const buttons = (result.action as Record<string, unknown>).buttons as Array<Record<string, unknown>>;
			const reply = (buttons[0] as Record<string, unknown>).reply as Record<string, unknown>;
			expect(reply.title).toBe('This is a very long ');
		});
	});

	describe('buildListPayload', () => {
		it('builds WHATSAPP_LIST payload with sections', () => {
			const result = buildListPayload('Select an option:', 'Choose', [
				{ payload: 'hitl|q|req123|0|0', title: 'Option A', description: 'First option' },
				{ payload: 'hitl|q|req123|0|1', title: 'Option B' },
			]);

			expect(result).toEqual({
				type: 'WHATSAPP_LIST',
				body: { text: 'Select an option:' },
				action: {
					button: 'Choose',
					sections: [
						{
							title: 'Options',
							rows: [
								{ payload: 'hitl|q|req123|0|0', title: 'Option A', description: 'First option' },
								{ payload: 'hitl|q|req123|0|1', title: 'Option B' },
							],
						},
					],
				},
			});
		});

		it('truncates row titles to 24 chars and descriptions to 72 chars', () => {
			const result = buildListPayload('Pick:', 'Go', [
				{
					payload: 'id1',
					title: 'A title that is way too long for the limit',
					description: 'A very long description that exceeds the seventy-two character limit set by the WhatsApp platform API spec',
				},
			]);

			const sections = (result.action as Record<string, unknown>).sections as Array<Record<string, unknown>>;
			const rows = (sections[0] as Record<string, unknown>).rows as Array<Record<string, unknown>>;
			expect((rows[0].title as string).length).toBe(24);
			expect((rows[0].description as string).length).toBe(72);
		});
	});

	describe('buildTemplatePayload', () => {
		it('builds TEMPLATE payload with body parameters', () => {
			const result = buildTemplatePayload('my_template', 'en_US', ['param1', 'param2']);

			expect(result).toEqual({
				type: 'TEMPLATE',
				elementName: 'my_template',
				languageCode: 'en_US',
				components: [
					{
						type: 'body',
						parameters: [
							{ type: 'text', text: 'param1' },
							{ type: 'text', text: 'param2' },
						],
					},
				],
			});
		});

		it('omits components when no body parameters', () => {
			const result = buildTemplatePayload('my_template', 'es', []);
			expect(result).toEqual({
				type: 'TEMPLATE',
				elementName: 'my_template',
				languageCode: 'es',
			});
		});
	});
});
