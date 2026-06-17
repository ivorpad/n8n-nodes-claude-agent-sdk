/**
 * Structured Output configuration properties
 *
 * Note: V1 query mode supports `outputFormat` with `resume` (multi-turn).
 * The SDK adds a `StructuredOutput` tool automatically. A system prompt
 * instruction is injected in index.ts to ensure the model calls this tool
 * before finishing, which is especially important for resumed sessions.
 * The removed unstable V2 Session API must not be reintroduced; local
 * execution uses query() with options.resume for deterministic sessions.
 */

import type { INodeProperties } from 'n8n-workflow';

export const structuredOutputProperties: INodeProperties[] = [
	{
		displayName: 'Structured Output',
		name: 'structuredOutput',
		type: 'boolean',
		default: false,
		description: 'Whether to enforce a JSON schema for the agent output. Use this when you need validated, structured data from the agent.',
	},
	{
		displayName: 'Schema Type',
		name: 'schemaType',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'From Attribute Descriptions',
				value: 'fromAttributes',
				description: 'Define output fields with names, types, and descriptions',
			},
			{
				name: 'Generate From JSON Example',
				value: 'fromJson',
				description: 'Generate a schema from an example JSON object',
			},
			{
				name: 'Define Using JSON Schema',
				value: 'manual',
				description: 'Define the JSON schema manually',
			},
		],
		default: 'fromAttributes',
		displayOptions: {
			show: {
				structuredOutput: [true],
			},
		},
		description: 'How to specify the output schema',
	},
	{
		displayName: 'Output Attributes',
		name: 'outputAttributes',
		placeholder: 'Add Attribute',
		type: 'fixedCollection',
		default: {},
		displayOptions: {
			show: {
				structuredOutput: [true],
				schemaType: ['fromAttributes'],
			},
		},
		typeOptions: {
			multipleValues: true,
		},
		options: [
			{
				name: 'attributes',
				displayName: 'Attribute List',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'Field name in the output (use snake_case)',
						placeholder: 'e.g. company_name',
						required: true,
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						description: 'Data type of the field',
						required: true,
						options: [
							{ name: 'Array of Numbers', value: 'numberArray' },
							{ name: 'Array of Strings', value: 'stringArray' },
							{ name: 'Boolean', value: 'boolean' },
							{ name: 'Number', value: 'number' },
							{ name: 'String', value: 'string' },
						],
						default: 'string',
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'Help the agent understand what this field should contain',
						placeholder: 'The name of the company mentioned in the text',
						required: true,
					},
					{
						displayName: 'Required',
						name: 'required',
						type: 'boolean',
						default: true,
						description: 'Whether this field must be present in the output',
					},
				],
			},
		],
	},
	{
		displayName: 'JSON Example',
		name: 'jsonSchemaExample',
		type: 'json',
		default: `{
	"result": "example value",
	"confidence": 0.95,
	"items": ["item1", "item2"]
}`,
		noDataExpression: true,
		typeOptions: {
			rows: 10,
		},
		displayOptions: {
			show: {
				structuredOutput: [true],
				schemaType: ['fromJson'],
			},
		},
		description: 'Example JSON object to use to generate the schema. All properties will be required.',
	},
	{
		displayName: 'All properties will be required. To make them optional, use the \'JSON Schema\' schema type instead.',
		name: 'jsonSchemaNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				structuredOutput: [true],
				schemaType: ['fromJson'],
			},
		},
	},
	{
		displayName: 'JSON Schema',
		name: 'outputJsonSchema',
		type: 'json',
		default: `{
	"type": "object",
	"properties": {
		"result": {
			"type": "string",
			"description": "The main result"
		},
		"confidence": {
			"type": "number",
			"description": "Confidence score between 0 and 1"
		}
	},
	"required": ["result"]
}`,
		noDataExpression: false,
		typeOptions: {
			rows: 10,
		},
		displayOptions: {
			show: {
				structuredOutput: [true],
				schemaType: ['manual'],
			},
		},
		description: 'JSON Schema defining the expected output structure',
		hint: 'Use <a target="_blank" href="https://json-schema.org/">JSON Schema</a> format. Supports object, array, string, number, boolean types.',
	},
	{
		displayName: 'On Structured Output Failure',
		name: 'structuredOutputFailureMode',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Continue With Error Payload',
				value: 'continueWithError',
				description: 'Return a normal task result with structured output error diagnostics',
			},
			{
				name: 'Throw Error',
				value: 'throwError',
				description: 'Fail the node when structured output retry exhaustion occurs',
			},
			{
				name: 'Fallback To Unstructured',
				value: 'fallbackToUnstructured',
				description: 'Return the summary text and mark that structured output fell back',
			},
		],
		default: 'continueWithError',
		displayOptions: {
			show: {
				structuredOutput: [true],
			},
		},
		description: 'How the node should behave when the SDK exhausts structured output retries',
	},
];
