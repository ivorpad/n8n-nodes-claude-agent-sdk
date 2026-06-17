/**
	* Binary Inputs configuration properties
 *
 * Allows users to download binary data from input items to the working directory,
 * making files available for Claude to read/process.
 */

import type { INodeProperties } from 'n8n-workflow';

export const binaryInputsProperties: INodeProperties[] = [

	{
		displayName: 'Download Binary Inputs',
		name: 'downloadBinaryInputs',
		type: 'boolean',
		default: false,
		description:
			'Whether to download binary data from input items to the working directory. ' +
			'Files are saved to _inputs/ subdirectory. Use placeholders in Task Description:<br>' +
			'<code>{files}</code> - Bullet list of paths | ' +
			'<code>{files:paths}</code> - Comma-separated paths | ' +
			'<code>{files:names}</code> - Filenames | ' +
			'<code>{attachment_0}</code> - Specific file',
	},
	{
		displayName: 'Input Directory',
		name: 'binaryInputDirectory',
		type: 'string',
		default: '_inputs',
		description: 'Subdirectory within working directory where files will be saved',
		displayOptions: {
			show: {
				downloadBinaryInputs: [true],
			},
		},
	},
	{
		displayName: 'Include File List in Prompt',
		name: 'includeFileList',
		type: 'boolean',
		default: true,
		description: 'Whether to append a list of downloaded files to the task description',
		displayOptions: {
			show: {
				downloadBinaryInputs: [true],
			},
		},
	},

];
