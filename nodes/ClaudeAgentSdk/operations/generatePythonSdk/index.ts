/**
 * Generate Python SDK Script
 *
 * Reads all node parameter values and produces a production-quality Python script
 * that uses the `claude_agent_sdk` package with equivalent configuration.
 *
 * The generated script:
 * - Handles all SDK message types (assistant, system, result, stream events)
 * - Uses argparse for CLI prompt override
 * - Includes proper error handling
 * - Uses triple-quoted strings for multi-line content
 * - Only imports types that are actually used
 * - Only emits non-default option values
 *
 * Parameter extraction lives in params.ts, ClaudeAgentOptions field builders
 * in optionBuilders.ts, the Python templates in scriptTemplates.ts, and the
 * literal-escaping helpers in pythonLiterals.ts (file-size guard split).
 */

import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { usesFullClaudeCodePromptPreset } from '../../claudeCodePromptSections';
import { addFastModeBeta, isAdaptiveThinkingModel, supportsOpusFastMode } from '../../claudeModels';
import { parseSkillsFilter } from '../executeTask/steps/querySetupHelpers';
import type { ExtractedParams } from './params';
import { readAllParams, sanitizeParamsForOutput } from './params';
import {
	buildAgentsBlock,
	buildFullEnvDict,
	buildMcpServersBlock,
	buildSettingSources,
	buildSystemPromptBlock,
	buildThinkingOption,
} from './optionBuilders';
import { assembleQueryScript, assembleStreamingScript } from './scriptTemplates';
import { esc, pyJsonLiteral, pyList } from './pythonLiterals';

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export function generatePythonSdkScript(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): INodeExecutionData {
	const params = readAllParams(execFunctions, itemIndex);
	const script = renderScript(params);
	const fileName = 'claude_agent.py';

	return {
		json: {
			type: 'python_sdk_script',
			filename: fileName,
			script,
			params: sanitizeParamsForOutput(params),
		},
		binary: {
			data: {
				data: Buffer.from(script, 'utf-8').toString('base64'),
				mimeType: 'text/x-python',
				fileName,
				fileExtension: 'py',
			},
		},
		pairedItem: { item: itemIndex },
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Script renderer
// ─────────────────────────────────────────────────────────────────────────────

function renderScript(p: ExtractedParams): string {
	const imports = new Set<string>();
	const optionLines: string[] = [];
	const isStreaming = p.enableStreaming;

	// Core types always needed
	imports.add('ClaudeAgentOptions');
	imports.add('AssistantMessage');
	imports.add('ResultMessage');
	imports.add('SystemMessage');
	imports.add('TextBlock');
	imports.add('ToolUseBlock');
	imports.add('ToolResultBlock');

	if (isStreaming) {
		imports.add('ClaudeSDKClient');
	} else {
		imports.add('query');
	}

	// Build ClaudeAgentOptions fields (only non-defaults)

	if (p.permissionMode && p.permissionMode !== 'default') {
		optionLines.push(`        permission_mode="${p.permissionMode}",`);
	}

	// Provider-specific model overrides mirror executeTask/querySetup semantics.
	const effectiveModel = p.apiProvider === 'ollama'
		? (p.ollamaModel || p.model)
		: p.apiProvider === 'alibaba'
			? (p.alibabaSonnetModel || '')
			: p.model;
	if (effectiveModel) {
		optionLines.push(`        model="${esc(effectiveModel)}",`);
	}

	const thinkingConfig = buildThinkingOption(p);
	if (thinkingConfig) {
		imports.add(thinkingConfig.importName);
		optionLines.push(`        thinking=${thinkingConfig.value},`);
	}

	if (p.effort && p.apiProvider !== 'alibaba') {
		optionLines.push(`        effort="${p.effort}",`);
	}

	const sysPromptBlock = buildSystemPromptBlock(p, imports);
	if (sysPromptBlock) {
		optionLines.push(sysPromptBlock);
	}

	const usesFullClaudeCodePreset = usesFullClaudeCodePromptPreset({
		useClaudeCodePreset: p.useClaudeCodePreset,
		selectedSections: p.claudeCodePromptSections,
	});
	if (!usesFullClaudeCodePreset) {
		optionLines.push(`        tools=${pyJsonLiteral({ type: 'preset', preset: 'claude_code' }, 8)},`);
	}

	if (p.allowedTools.length > 0) {
		optionLines.push(`        allowed_tools=${pyList(p.allowedTools)},`);
	}

	// Merge disallowedTools and blockedTools (comma-separated) into a single list
	const mergedDisallowed = [...p.disallowedTools];
	if (p.blockedTools) {
		const blocked = p.blockedTools.split(',').map((t) => t.trim()).filter(Boolean);
		for (const tool of blocked) {
			if (!mergedDisallowed.includes(tool)) {
				mergedDisallowed.push(tool);
			}
		}
	}
	if (mergedDisallowed.length > 0) {
		optionLines.push(`        disallowed_tools=${pyList(mergedDisallowed)},`);
	}

	if (p.maxTurns > 0) {
		optionLines.push(`        max_turns=${p.maxTurns},`);
	}

	if (p.chatSessionId) {
		optionLines.push(`        session_id="${esc(p.chatSessionId)}",`);
	}

	if (p.maxBudgetUsd > 0) {
		optionLines.push(`        max_budget_usd=${p.maxBudgetUsd},`);
	}

	if (p.workingDirectory) {
		optionLines.push(`        cwd="${esc(p.workingDirectory)}",`);
	}

	if (p.additionalDirectories) {
		const dirs = p.additionalDirectories.split(',').map((d) => d.trim()).filter(Boolean);
		if (dirs.length > 0) {
			optionLines.push(`        add_dirs=${pyList(dirs)},`);
		}
	}

	const settingSources = buildSettingSources(p);
	if (settingSources) {
		optionLines.push(`        setting_sources=${settingSources},`);
	}

	const envDict = buildFullEnvDict(p);
	if (envDict) {
		optionLines.push(`        env=${envDict},`);
	}

	if (p.forkSession) {
		optionLines.push('        fork_session=True,');
	}

	if (p.includePartialMessages) {
		optionLines.push('        include_partial_messages=True,');
	}

	// persistSession / promptSuggestions / correlationId are TypeScript-SDK-only
	// options — the Python ClaudeAgentOptions dataclass rejects unknown kwargs
	// with a TypeError, so they surface as docstring notes instead (see
	// buildExportNotes).

	if (p.enableFileCheckpointing) {
		optionLines.push('        enable_file_checkpointing=True,');
	}

	// Fast mode rides on the fast-mode beta header, mirroring querySetupContext.
	const betas = p.fastMode && supportsOpusFastMode(effectiveModel)
		? addFastModeBeta(p.betas)
		: p.betas;
	if (betas.length > 0) {
		optionLines.push(`        betas=${pyList(betas)},`);
	}

	const skills = parseSkillsFilter(p.skillsFilter);
	if (skills === 'all') {
		optionLines.push('        skills="all",');
	} else if (skills && skills.length > 0) {
		optionLines.push(`        skills=${pyList(skills)},`);
	}

	// Legacy fixed budget — never emitted for adaptive-only models. On Fable 5
	// the thinking option is omitted entirely when disabled, and a leaked
	// max_thinking_tokens would re-introduce the removed budget path (400).
	if (p.maxThinkingTokens > 0 && !thinkingConfig && !isAdaptiveThinkingModel(p.model)) {
		optionLines.push(`        max_thinking_tokens=${p.maxThinkingTokens},`);
	}

	if (p.maxBufferSizeMb > 1) {
		const bytes = Math.round(p.maxBufferSizeMb * 1024 * 1024);
		optionLines.push(`        max_buffer_size=${bytes},  # ${p.maxBufferSizeMb} MB`);
	}

	if (p.plugins.length > 0) {
		const plugins = p.plugins.map((pluginPath) => ({ type: 'local', path: pluginPath }));
		optionLines.push(`        plugins=${pyJsonLiteral(plugins, 8)},`);
	}

	const mcpBlock = buildMcpServersBlock(p);
	if (mcpBlock) {
		optionLines.push(mcpBlock);
	}

	const agentsBlock = buildAgentsBlock(p);
	if (agentsBlock) {
		imports.add('AgentDefinition');
		optionLines.push(agentsBlock);
	}

	if (p.outputFormat) {
		optionLines.push(`        output_format=${pyJsonLiteral(p.outputFormat, 8)},`);
	}

	// Assemble — split imports: some types live in claude_agent_sdk.types
	const TYPES_SUBMODULE = new Set(['StreamEvent', 'SystemPromptPreset']);
	const mainImports = [...imports].filter((i) => !TYPES_SUBMODULE.has(i)).sort();
	const typesImports = [...imports].filter((i) => TYPES_SUBMODULE.has(i)).sort();

	// Build prompt: prepend userPromptContext if set. Join with real newlines —
	// esc() renders them as \n escapes in the Python literal; a pre-escaped
	// "\\n" would double-escape into literal backslash-n text in the prompt.
	let fullPrompt = p.taskDescription || '';
	if (p.userPromptContext) {
		fullPrompt = fullPrompt
			? `${p.userPromptContext}\n\n${p.taskDescription}`
			: p.userPromptContext;
	}
	const promptStr = esc(fullPrompt);
	const hasPrompt = fullPrompt.trim().length > 0;

	const optionsBody = optionLines.length > 0
		? `    options = ClaudeAgentOptions(\n${optionLines.join('\n')}\n    )`
		: '    options = ClaudeAgentOptions()';

	if (isStreaming) {
		return assembleStreamingScript(mainImports, typesImports, optionsBody, promptStr, hasPrompt, p);
	}
	return assembleQueryScript(mainImports, typesImports, optionsBody, promptStr, hasPrompt, p);
}
