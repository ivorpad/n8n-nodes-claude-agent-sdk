/**
 * Configuration builders for executeTask operation
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { ApplicationError, jsonParse } from 'n8n-workflow';
import type { JsonSchema, AttributeDefinition } from '../../types';
import type { UpstreamQueryOptions } from '../../sdk/types';
import {
	buildSelectedClaudeCodePrompt,
	type ClaudeCodePromptSectionsContext,
	usesFullClaudeCodePromptPreset,
} from '../../claudeCodePromptSections';
import {
	assertValidJsonSchema,
	ensureNoAdditionalProperties,
	generateSchemaFromAttributes,
	generateSchemaFromExample,
} from '../../schema';

// Environment assembly moved to ./environment — re-exported here so existing
// importers (querySetupParts, index, tests) keep their import path.
export { buildEnvironment, buildMcpHeaderEnvironment } from './environment';
export type {
	BuildEnvironmentOptions,
	EnvironmentSecurityOptions,
	ProxyManagerConfig,
} from './environment';

/**
 * Build system prompt configuration
 *
 * When useClaudeCodePreset is true (default), the Claude Code preset is used
 * as the base system prompt. This establishes a "Claude Code" identity and
 * injects CLAUDE.md content as project context.
 *
 * When useClaudeCodePreset is false, the custom prompt is used directly as the
 * system prompt. CLAUDE.md is still loaded (via settingSources) but the agent's
 * identity is defined entirely by the custom prompt — no "Claude Code" identity
 * override. This is ideal for chatbots and custom-identity agents.
 */
export function buildSystemPromptConfig(
	settingSources: string[],
	customPrompt: string | undefined,
	subagentInstructions: string,
	useClaudeCodePreset = true,
	selectedClaudeCodePromptSections: string[] | undefined = undefined,
	claudeCodePromptContext: ClaudeCodePromptSectionsContext | undefined = undefined,
): UpstreamQueryOptions['systemPrompt'] {
	const selectedClaudeCodePrompt = claudeCodePromptContext
		? buildSelectedClaudeCodePrompt({
				selectedSections: selectedClaudeCodePromptSections,
				context: claudeCodePromptContext,
			})
		: undefined;
	const fullAppend = [selectedClaudeCodePrompt, customPrompt, subagentInstructions]
		.filter((value): value is string => Boolean(value))
		.join('\n\n');
	const usesFullPreset = usesFullClaudeCodePromptPreset({
		useClaudeCodePreset,
		selectedSections: selectedClaudeCodePromptSections,
	});

	if (settingSources.length > 0 && usesFullPreset) {
		// Use Claude Code preset (establishes "Claude Code" identity, injects CLAUDE.md)
		if (fullAppend) {
			return {
				type: 'preset',
				preset: 'claude_code',
				append: fullAppend,
			};
		}
		return {
			type: 'preset',
			preset: 'claude_code',
		};
	}

	// No preset: use custom prompt directly (CLAUDE.md still loaded via settingSources)
	return fullAppend || undefined;
}

/**
 * Build structured output configuration
 */
export function buildStructuredOutputConfig(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): UpstreamQueryOptions['outputFormat'] {
	const structuredOutput = execFunctions.getNodeParameter(
		'structuredOutput',
		itemIndex,
		false,
	) as boolean;

	if (!structuredOutput) {
		return undefined;
	}

	const schemaType = execFunctions.getNodeParameter('schemaType', itemIndex, 'fromAttributes') as
		| 'fromAttributes'
		| 'fromJson'
		| 'manual';

	let outputSchema: JsonSchema;
	try {
		if (schemaType === 'fromAttributes') {
			const attributesInput = execFunctions.getNodeParameter('outputAttributes', itemIndex, {}) as {
				attributes?: AttributeDefinition[];
			};
			const attributes = attributesInput.attributes || [];
			if (attributes.length === 0) {
				throw new ApplicationError('At least one output attribute must be specified');
			}
			outputSchema = generateSchemaFromAttributes(attributes);
		} else if (schemaType === 'fromJson') {
			const jsonExample = execFunctions.getNodeParameter(
				'jsonSchemaExample',
				itemIndex,
				'{}',
			) as string;
			outputSchema = generateSchemaFromExample(jsonExample);
		} else {
			const manualSchema = execFunctions.getNodeParameter(
				'outputJsonSchema',
				itemIndex,
				'{}',
			) as string;
			outputSchema = jsonParse<JsonSchema>(manualSchema);
		}

		// Ensure additionalProperties: false on all object nodes.
		// The Anthropic API requires this for structured outputs.
		outputSchema = ensureNoAdditionalProperties(outputSchema);
		assertValidJsonSchema(outputSchema);

		return {
			type: 'json_schema',
			// JsonSchema is an interface (no implicit index signature); the
			// canonical outputFormat.schema is Record<string, unknown> — safe upcast.
			schema: outputSchema as unknown as Record<string, unknown>,
		};
	} catch (error) {
		if (error instanceof ApplicationError) {
			throw error;
		}
		throw new ApplicationError(
			`Invalid ${schemaType === 'fromJson' ? 'JSON example' : schemaType === 'manual' ? 'JSON schema' : 'attribute definition'}: ${error}`,
		);
	}
}
