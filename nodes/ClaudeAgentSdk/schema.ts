/**
 * JSON Schema generation utilities
 */

import Ajv, { type ErrorObject } from 'ajv';
import { ApplicationError, jsonParse } from 'n8n-workflow';
import type { JsonSchema, AttributeDefinition } from './types';

const schemaValidationAjv = new Ajv({
	allErrors: true,
	validateSchema: true,
});

const outputValidationAjv = new Ajv({
	allErrors: true,
});

function isJsonSchemaObject(value: unknown): value is JsonSchema {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapSchemaRecord(
	record: Record<string, JsonSchema> | undefined,
): Record<string, JsonSchema> | undefined {
	if (!record) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(record).map(([key, value]) => [key, ensureNoAdditionalProperties(value)]),
	);
}

function mapSchemaArray(values: JsonSchema[] | undefined): JsonSchema[] | undefined {
	return values?.map((value) => ensureNoAdditionalProperties(value));
}

function normalizeItems(
	items: JsonSchema | JsonSchema[] | undefined,
): JsonSchema | JsonSchema[] | undefined {
	if (Array.isArray(items)) {
		return items.map((item) => ensureNoAdditionalProperties(item));
	}

	if (isJsonSchemaObject(items)) {
		return ensureNoAdditionalProperties(items);
	}

	return items;
}

function normalizeAdditionalProperties(
	additionalProperties: boolean | JsonSchema | undefined,
): boolean | JsonSchema | undefined {
	if (isJsonSchemaObject(additionalProperties)) {
		return ensureNoAdditionalProperties(additionalProperties);
	}
	return additionalProperties;
}

function schemaTypeIncludes(schema: JsonSchema, type: string): boolean {
	if (Array.isArray(schema.type)) {
		return schema.type.includes(type);
	}
	return schema.type === type;
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
	if (!errors || errors.length === 0) {
		return 'Unknown validation error';
	}

	return errors.map((error) => {
		const location = ('instancePath' in error && typeof error.instancePath === 'string' && error.instancePath)
			|| ('dataPath' in error && typeof error.dataPath === 'string' && error.dataPath)
			|| '(root)';
		if (
			error.keyword === 'required'
			&& typeof error.params === 'object'
			&& error.params !== null
			&& 'missingProperty' in error.params
		) {
			return `${location}: missing required property "${String(error.params.missingProperty)}"`;
		}
		return `${location}: ${error.message ?? error.keyword}`;
	}).join('; ');
}

/**
 * Ensure `additionalProperties: false` on every object node in a schema.
 * The Anthropic API requires object schemas to explicitly disable extras.
 */
export function ensureNoAdditionalProperties(schema: JsonSchema): JsonSchema {
	const normalized: JsonSchema = {
		...schema,
		properties: mapSchemaRecord(schema.properties),
		items: normalizeItems(schema.items),
		allOf: mapSchemaArray(schema.allOf),
		anyOf: mapSchemaArray(schema.anyOf),
		oneOf: mapSchemaArray(schema.oneOf),
		prefixItems: mapSchemaArray(schema.prefixItems),
		$defs: mapSchemaRecord(schema.$defs),
		definitions: mapSchemaRecord(schema.definitions),
		additionalProperties: normalizeAdditionalProperties(schema.additionalProperties),
	};

	if (isJsonSchemaObject(schema.not)) {
		normalized.not = ensureNoAdditionalProperties(schema.not);
	}

	if (schemaTypeIncludes(schema, 'object') && normalized.properties) {
		normalized.additionalProperties = false;
	}

	return normalized;
}

/**
 * Validate that a user-provided schema is itself valid JSON Schema.
 */
export function assertValidJsonSchema(schema: JsonSchema): void {
	const isValid = schemaValidationAjv.validateSchema(schema as Record<string, unknown>);
	if (!isValid) {
		throw new ApplicationError(`Invalid JSON Schema: ${formatAjvErrors(schemaValidationAjv.errors)}`);
	}
}

/**
 * Validate a structured output value against a JSON Schema.
 */
export function validateStructuredOutputValue(
	value: unknown,
	schema: JsonSchema,
): { success: true } | { success: false; error: string } {
	try {
		const validate = outputValidationAjv.compile(schema as Record<string, unknown>);
		if (validate(value)) {
			return { success: true };
		}
		return {
			success: false,
			error: formatAjvErrors(validate.errors),
		};
	} catch (error) {
		return {
			success: false,
			error: `Failed to validate structured output: ${(error as Error).message}`,
		};
	}
}

/**
 * Generate JSON Schema from a value
 */
export function generateSchemaFromValue(value: unknown): JsonSchema {
	if (value === null) {
		return { type: 'null' };
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			return { type: 'array', items: { type: 'string' } };
		}
		// Use first item as template for array items
		return {
			type: 'array',
			items: generateSchemaFromValue(value[0]),
		};
	}

	switch (typeof value) {
		case 'string':
			return { type: 'string' };
		case 'number':
			return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
		case 'boolean':
			return { type: 'boolean' };
		case 'object': {
			const obj = value as Record<string, unknown>;
			const properties: Record<string, JsonSchema> = {};
			const required: string[] = [];

			for (const [key, val] of Object.entries(obj)) {
				properties[key] = generateSchemaFromValue(val);
				required.push(key);
			}

			return {
				type: 'object',
				properties,
				required,
				additionalProperties: false,
			};
		}
		default:
			return { type: 'string' };
	}
}

/**
 * Generate JSON Schema from a JSON example string
 */
export function generateSchemaFromExample(exampleJsonString: string): JsonSchema {
	const parsed = jsonParse<unknown>(exampleJsonString);
	return generateSchemaFromValue(parsed);
}

/**
 * Generate JSON Schema from attribute definitions
 */
export function generateSchemaFromAttributes(attributes: AttributeDefinition[]): JsonSchema {
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];

	for (const attr of attributes) {
		let propSchema: JsonSchema;

		switch (attr.type) {
			case 'string':
				propSchema = { type: 'string', description: attr.description };
				break;
			case 'number':
				propSchema = { type: 'number', description: attr.description };
				break;
			case 'boolean':
				propSchema = { type: 'boolean', description: attr.description };
				break;
			case 'stringArray':
				propSchema = {
					type: 'array',
					items: { type: 'string' },
					description: attr.description,
				};
				break;
			case 'numberArray':
				propSchema = {
					type: 'array',
					items: { type: 'number' },
					description: attr.description,
				};
				break;
			default:
				propSchema = { type: 'string', description: attr.description };
		}

		properties[attr.name] = propSchema;

		if (attr.required) {
			required.push(attr.name);
		}
	}

	return {
		type: 'object',
		properties,
		...(required.length > 0 && { required }),
		additionalProperties: false,
	};
}
