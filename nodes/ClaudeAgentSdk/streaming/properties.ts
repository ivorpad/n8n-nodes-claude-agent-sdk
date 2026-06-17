/**
 * Streaming Configuration UI Properties
 *
 * n8n node property definitions for comprehensive streaming control.
 * Provides granular control over what content types are streamed and how they're formatted.
 */

import type { INodeProperties } from 'n8n-workflow';

import { STREAMING_CONTENT_TYPE_OPTIONS } from './contentTypeOptions';

/**
 * Streaming Configuration - Properties shown when streaming is enabled
 *
 * Field visibility:
 * - Enable Streaming: Standalone toggle at top level, always visible for executeTask
 * - All other settings: Show when enableStreaming=true
 * - Custom markers: Show when enableStreaming=true AND streamingMarkerFormat=custom
 */
export const streamingConfigProperties: INodeProperties[] = [
	// Top-level toggle (NOT inside collection - fixes n8n serialization bug)
	{
		displayName: "Enable Streaming",
		name: "enableStreaming",
		type: "boolean",
		default: false,
		description: "Whether to stream responses in real-time as they are generated. Requires a streaming-capable trigger (e.g., Chat Trigger).",
	},
	// Collection for additional streaming options
	{
		displayName: "Streaming Options",
		name: "streamingOptions",
		type: "collection",
		placeholder: "Add Streaming Option",
		default: {},
		displayOptions: {
			show: {
				enableStreaming: [true],
			},
		},
		options: [
			{
				displayName: "Use Text Markers",
				name: "useMarkers",
				type: "boolean",
				default: false,
				description: "Whether to wrap content in text markers like [TOOL_CALL:...]. When disabled (default), content is streamed as clean JSON objects.",
			},
			{
				displayName: "Marker Format",
				name: "streamingMarkerFormat",
				type: "options",
				options: [
					{
						name: "JSON Metadata (Recommended)",
						value: "jsonMeta",
						description: "Markers with parseable JSON metadata for easy frontend handling",
					},
					{
						name: "Simple Tags",
						value: "simple",
						description: "Simple markers like [TOOL_CALL:Read] without JSON",
					},
					{
						name: "Custom",
						value: "custom",
						description: "Define your own marker templates",
					},
				],
				default: "jsonMeta",
				description: "Format of the markers used to wrap streamed content",
				displayOptions: {
					show: {
						useMarkers: [true],
					},
				},
			},
			{
				displayName: "Stream Content Types",
				name: "streamingContentTypes",
				type: "multiOptions",
				options: STREAMING_CONTENT_TYPE_OPTIONS,
				default: ["text", "structuredOutput"],
				description: "Select which SDK message types to stream. Messages are passed through verbatim.",
			},
			{
				displayName: "Display Settings",
				name: "displaySettings",
				type: "fixedCollection",
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: "Control how tool input/output is displayed in the stream",
				options: [
					{
						displayName: "Settings",
						name: "settings",
						values: [
							{
								displayName: "Tool Input Display",
								name: "streamingToolInputDisplay",
								type: "options",
								options: [
									{
										name: "Full JSON",
										value: "full",
										description: "Include complete input JSON in tool call markers",
									},
									{
										name: "Truncated",
										value: "truncated",
										description: "Truncate inputs over the character limit",
									},
									{
										name: "Name Only",
										value: "nameOnly",
										description: "Only show tool name, no input data",
									},
								],
								default: "truncated",
								description: "How to display tool call input in the stream",
							},
							{
								displayName: "Tool Result Display",
								name: "streamingToolResultDisplay",
								type: "options",
								options: [
									{
										name: "Full Results",
										value: "full",
										description: "Include complete result content",
									},
									{
										name: "Truncated",
										value: "truncated",
										description: "Truncate results over the character limit",
									},
									{
										name: "Summary Only",
										value: "summary",
										description: "Just show success/error status, no content",
									},
								],
								default: "truncated",
								description: "How to display tool results in the stream",
							},
							{
								displayName: "Truncation Limit",
								name: "streamingTruncationLimit",
								type: "number",
								default: 500,
								description: "Maximum characters before truncation (adds '...' suffix)",
							},
						],
					},
				],
			},
			{
				displayName: "Tool Filtering",
				name: "toolFiltering",
				type: "fixedCollection",
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: "Filter which tools are included in streaming output",
				options: [
					{
						displayName: "Settings",
						name: "settings",
						values: [
							{
								displayName: "Tool Filter",
								name: "streamingToolFilter",
								type: "options",
								options: [
									{
										name: "All Tools",
										value: "all",
										description: "Stream all tool calls and results",
									},
									{
										name: "By Category",
										value: "categories",
										description: "Select tool categories to stream",
									},
									{
										name: "Specific Tools",
										value: "specific",
										description: "Specify exact tool names to stream",
									},
								],
								default: "all",
								description: "Filter which tools to include in streaming",
							},
							{
								displayName: "Tool Categories",
								name: "streamingToolCategories",
								type: "multiOptions",
								options: [
									{
										name: "Agent Tools (Task, TaskCreate, Monitor)",
										value: "agent",
										description: "Task delegation, task tracking, monitoring, user interaction",
									},
									{
										name: "Bash Commands (Bash, BashOutput, KillShell)",
										value: "bash",
										description: "Shell command execution",
									},
									{
										name: "File Operations (Read, Write, Edit, Glob, Grep)",
										value: "file",
										description: "File reading, writing, searching",
									},
									{
										name: "MCP Tools (Mcp__*)",
										value: "mcp",
										description: "All Model Context Protocol server tools",
									},
									{
										name: "Web/Network (WebFetch, WebSearch)",
										value: "web",
										description: "Web fetching and searching",
									},
								],
								default: [],
								description: "Select which tool categories to stream",
								displayOptions: {
									show: {
										streamingToolFilter: ["categories"],
									},
								},
							},
							{
								displayName: "Specific Tools",
								name: "streamingSpecificTools",
								type: "string",
								default: "",
								placeholder: "Read, Bash, WebFetch, mcp__myserver__mytool",
								description: "Comma-separated list of tool names to stream. Supports wildcards: mcp__* for all MCP tools.",
								displayOptions: {
									show: {
										streamingToolFilter: ["specific"],
									},
								},
							},
						],
					},
				],
			},
			{
				displayName: "Custom Markers",
				name: "customMarkers",
				type: "fixedCollection",
				typeOptions: {
					multipleValues: false,
				},
				default: {},
				description: "Define custom marker templates for streamed content",
				displayOptions: {
					show: {
						useMarkers: [true],
						streamingMarkerFormat: ["custom"],
					},
				},
				options: [
					{
						displayName: "Markers",
						name: "markers",
						values: [
							{
								displayName: "JSON Message End Marker",
								name: "streamingJsonMsgEndMarker",
								type: "string",
								default: "[/MSG]",
								placeholder: "[/MSG]",
								description: "Marker after JSON message",
							},
							{
								displayName: "JSON Message Start Marker",
								name: "streamingJsonMsgStartMarker",
								type: "string",
								default: "[MSG:{type}]",
								placeholder: "[MSG:{type}]",
								description: "Marker before JSON message. Placeholders: {type}, {subtype}.",
							},
							{
								displayName: "Subagent End Marker",
								name: "streamingSubagentEndMarker",
								type: "string",
								default: "[SUBAGENT_END:{name}]",
								placeholder: "[SUBAGENT_END:{name}]",
								description: "Marker when subagent ends. Placeholders: {name}, {ID}.",
							},
							{
								displayName: "Subagent Message End Marker",
								name: "streamingSubagentMsgEndMarker",
								type: "string",
								default: "[/SUBAGENT_MSG]",
								placeholder: "[/SUBAGENT_MSG]",
								description: "Marker after subagent text",
							},
							{
								displayName: "Subagent Message Start Marker",
								name: "streamingSubagentMsgStartMarker",
								type: "string",
								default: "[SUBAGENT_MSG:{name}]",
								placeholder: "[SUBAGENT_MSG:{name}]",
								description: "Marker before subagent text. Placeholders: {name}.",
							},
							{
								displayName: "Subagent Start Marker",
								name: "streamingSubagentStartMarker",
								type: "string",
								default: "[SUBAGENT_START:{name}]",
								placeholder: "[SUBAGENT_START:{name}]",
								description: "Marker when subagent starts. Placeholders: {name}, {ID}.",
							},
							{
								displayName: "Todo End Marker",
								name: "streamingTodoEndMarker",
								type: "string",
								default: "[/TODO_UPDATE]",
								placeholder: "[/TODO_UPDATE]",
								description: "Marker after todo update JSON",
							},
							{
								displayName: "Todo Start Marker",
								name: "streamingTodoStartMarker",
								type: "string",
								default: "[TODO_UPDATE]",
								placeholder: "[TODO_UPDATE]",
								description: "Marker before todo update JSON",
							},
							{
								displayName: "Tool Call End Marker",
								name: "streamingToolCallEndMarker",
								type: "string",
								default: "[/TOOL_CALL]",
								placeholder: "[/TOOL_CALL]",
								description: "Marker after tool call content",
							},
							{
								displayName: "Tool Call Start Marker",
								name: "streamingToolCallStartMarker",
								type: "string",
								default: "[TOOL_CALL:{name}]",
								placeholder: "[TOOL_CALL:{name}]",
								description: "Marker before tool call content. Placeholders: {name}, {ID}.",
							},
							{
								displayName: "Tool Result End Marker",
								name: "streamingToolResultEndMarker",
								type: "string",
								default: "[/TOOL_RESULT]",
								placeholder: "[/TOOL_RESULT]",
								description: "Marker after tool result content",
							},
							{
								displayName: "Tool Result Start Marker",
								name: "streamingToolResultStartMarker",
								type: "string",
								default: "[TOOL_RESULT:{name}]",
								placeholder: "[TOOL_RESULT:{name}]",
								description: "Marker before tool result. Placeholders: {name}, {ID}, {success}.",
							},
							{
								displayName: "User Message End Marker",
								name: "streamingUserMsgEndMarker",
								type: "string",
								default: "[/USER_MSG]",
								placeholder: "[/USER_MSG]",
								description: "Marker after user message content",
							},
							{
								displayName: "User Message Start Marker",
								name: "streamingUserMsgStartMarker",
								type: "string",
								default: "[USER_MSG]",
								placeholder: "[USER_MSG]",
								description: "Marker before user message content",
							},
						],
					},
				],
			},
		],
	},
];
