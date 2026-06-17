/**
 * Node properties for converting managed-agent generated files into n8n
 * binary attachments. Only visible when backendMode = 'managedAgent'.
 *
 * The managed-agent adapter already downloads session-scoped files after
 * `session.status_idle` and yields them as `artifact` events with
 * content.type === 'file' (base64-encoded). These properties drive a
 * post-execution step in executeTask that converts those artifacts into
 * n8n binary data so downstream nodes (Send Email, S3 Upload, HTTP, …)
 * can consume them as attachments without extra wiring.
 */

import type { INodeProperties } from 'n8n-workflow';

export const managedAgentBinaryOutputsProperties: INodeProperties[] = [
	{
		displayName: 'Download Generated Files as Binary',
		name: 'downloadGeneratedFiles',
		type: 'boolean',
		default: false,
		description:
			'Whether to attach files the managed agent wrote during this turn as ' +
			'n8n binary data (key "data") on the output. The node fans out one ' +
			'item per file. With zero files generated, output is unchanged from ' +
			'today (single task_result item, no binary).',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
			},
		},
	},
	{
		displayName: 'Filename Filter (Globs)',
		name: 'generatedFilesFilter',
		type: 'string',
		default: '',
		placeholder: '*.pdf, report-*.csv',
		description:
			'Comma-separated filename globs. Empty = include all. Patterns match ' +
			'the filename only.',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
				downloadGeneratedFiles: [true],
			},
		},
	},
	{
		displayName: 'MIME Type Prefix Filter',
		name: 'generatedFilesMimePrefix',
		type: 'string',
		default: '',
		placeholder: 'image/, application/pdf',
		description:
			'Comma-separated MIME prefixes. Empty = include all. Example "image/" ' +
			'matches every image MIME.',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
				downloadGeneratedFiles: [true],
			},
		},
	},
	{
		displayName: 'Max File Size (MB)',
		name: 'generatedFilesMaxSizeMb',
		type: 'number',
		default: 50,
		description: 'Skip files larger than this. 0 = no limit.',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
				downloadGeneratedFiles: [true],
			},
		},
	},
	{
		displayName: 'Strip Base64 From task_result.artifacts',
		name: 'generatedFilesStripBase64',
		type: 'boolean',
		default: true,
		description:
			'Whether to remove the inline base64 from the JSON copy once the file ' +
			'has been attached as binary. Avoids the same payload appearing twice ' +
			'in the workflow data and keeps execution storage small. Off keeps ' +
			'the existing behaviour (base64 stays inside artifacts[]).',
		displayOptions: {
			show: {
				operation: ['executeTask'],
				backendMode: ['managedAgent'],
				downloadGeneratedFiles: [true],
			},
		},
	},
];
