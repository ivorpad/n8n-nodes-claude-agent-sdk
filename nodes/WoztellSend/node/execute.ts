import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { sendResponses } from '../transport/woztell';
import type { WoztellSendOperation } from '../types';

function parseTemplateId(templateId: string): { name: string; languageCode: string } {
	const sepIndex = templateId.indexOf('|');
	if (sepIndex === -1) return { name: templateId, languageCode: 'es' };
	return {
		name: templateId.slice(0, sepIndex),
		languageCode: templateId.slice(sepIndex + 1),
	};
}

function buildTextPayload(text: string): Record<string, unknown> {
	return { type: 'TEXT', text };
}

function buildListPayload(args: {
	header?: string;
	body: string;
	footer?: string;
	buttonText: string;
	sections: Array<{ title?: string; rows: Array<{ id?: string; title: string; description?: string }> }>;
}): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		type: 'WHATSAPP_LIST',
		body: { text: args.body },
		action: {
			button: args.buttonText,
			sections: args.sections.map((section, si) => ({
				...(section.title ? { title: section.title } : {}),
				rows: section.rows.map((row, ri) => ({
					payload: row.id || `s${si}_r${ri}`,
					title: row.title.slice(0, 24),
					...(row.description ? { description: row.description.slice(0, 72) } : {}),
				})),
			})),
		},
	};

	if (args.header) {
		payload.header = { type: 'text', text: args.header };
	}
	if (args.footer) {
		payload.footer = { text: args.footer };
	}

	return payload;
}

function buildTemplatePayload(args: {
	templateName: string;
	languageCode: string;
	bodyParameters: string[];
}): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		type: 'TEMPLATE',
		elementName: args.templateName,
		languageCode: args.languageCode,
	};

	if (args.bodyParameters.length > 0) {
		payload.components = [
			{
				type: 'body',
				parameters: args.bodyParameters.map((value) => ({ type: 'text', text: value })),
			},
		];
	}

	return payload;
}

export async function execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const results: INodeExecutionData[] = [];

	for (let i = 0; i < items.length; i++) {
		try {
			const operation = this.getNodeParameter('operation', i) as WoztellSendOperation;
			const channelId = this.getNodeParameter('channelId', i) as string;
			const recipientId = this.getNodeParameter('recipientId', i) as string;

			let responsePayload: Record<string, unknown>[];

			if (operation === 'sendList') {
				const precedingText = this.getNodeParameter('listPrecedingText', i, '') as string;
				const listHeader = this.getNodeParameter('listHeader', i, '') as string;
				const listBody = this.getNodeParameter('listBody', i) as string;
				const listButtonText = this.getNodeParameter('listButtonText', i, 'View options') as string;
				const listFooter = this.getNodeParameter('listFooter', i, '') as string;
				const sectionsRaw = this.getNodeParameter('listSections', i) as string | object;

				let sections: Array<{ title?: string; rows: Array<{ id?: string; title: string; description?: string }> }>;
				try {
					sections = typeof sectionsRaw === 'string' ? JSON.parse(sectionsRaw) : sectionsRaw as typeof sections;
				} catch {
					throw new NodeOperationError(this.getNode(), 'Sections JSON is not valid JSON', { itemIndex: i });
				}

				if (!Array.isArray(sections) || sections.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Sections must be a non-empty JSON array', { itemIndex: i });
				}

				responsePayload = [];

				if (precedingText.trim()) {
					responsePayload.push(buildTextPayload(precedingText));
				}

				responsePayload.push(buildListPayload({
					header: listHeader || undefined,
					body: listBody,
					footer: listFooter || undefined,
					buttonText: listButtonText,
					sections,
				}));
			} else if (operation === 'sendTemplate') {
				const templateId = this.getNodeParameter('templateId', i, '') as string;
				const bodyParamsRaw = this.getNodeParameter('templateBodyParameters', i, '') as string;
				const { name: templateName, languageCode } = parseTemplateId(templateId);
				const bodyParameters = bodyParamsRaw
					? bodyParamsRaw.split(',').map((p) => p.trim())
					: [];

				responsePayload = [buildTemplatePayload({ templateName, languageCode, bodyParameters })];
			} else {
				const message = this.getNodeParameter('message', i) as string;
				responsePayload = [buildTextPayload(message)];
			}

			const apiResult = await sendResponses(this, channelId, recipientId, responsePayload);

			results.push({
				json: {
					success: true,
					channelId,
					recipientId,
					operation,
					...apiResult,
				},
			});
		} catch (error) {
			if (this.continueOnFail()) {
				results.push({
					json: {
						error: (error as Error).message,
					},
				});
			} else {
				throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
			}
		}
	}

	return [results];
}
