/**
 * Stream Content Type options for the streaming multiOptions dropdown.
 * Values must stay in lockstep with StreamContentType (./types).
 */

import type { INodePropertyOptions } from 'n8n-workflow';

export const STREAMING_CONTENT_TYPE_OPTIONS: INodePropertyOptions[] = [
	// SDK Message Types (verbatim - recommended)
	{
		name: "All SDK Messages",
		value: "all",
		description: "Stream all SDK messages verbatim (recommended for full visibility)",
	},
	{
		name: "Assistant Messages",
		value: "assistant",
		description: "Stream assistant messages with content blocks (text, tool_use)",
	},
	{
		name: "User Messages",
		value: "user",
		description: "Stream user messages with tool results",
	},
	{
		name: "Result Messages",
		value: "result",
		description: "Stream final result with usage stats and structured output",
	},
	{
		name: "System Messages (All)",
		value: "system",
		description: "Stream all system messages (init, status, api_retry, informational, model refusal, task lifecycle, permission_denied, worker shutdown)",
	},
	{
		name: "System: Init",
		value: "system:init",
		description: "Stream session initialization messages",
	},
	{
		name: "System: Status",
		value: "system:status",
		description: "Stream status updates (e.g., requesting, compacting)",
	},
	{
		name: "System: API Retry",
		value: "system:api_retry",
		description: "Stream API retry notices, including overloaded and rate_limit causes",
	},
	{
		name: "System: Informational",
		value: "system:informational",
		description: "Stream informational system banners and hook feedback",
	},
	{
		name: "System: Model Refusal (No Fallback)",
		value: "system:model_refusal_no_fallback",
		description: "Stream model refusal notices when no fallback model is available",
	},
	{
		name: "Stream Events (Deltas)",
		value: "stream_event",
		description: "Stream real-time streaming deltas (for token-by-token display)",
	},
	{
		name: "Tool Progress",
		value: "tool_progress",
		description: "Stream tool execution progress updates",
	},
	{
		name: "Auth Status",
		value: "auth_status",
		description: "Stream authentication status messages",
	},
	{
		name: "System: Task Started",
		value: "system:task_started",
		description: "Stream task started events (subagent/background task lifecycle)",
	},
	{
		name: "System: Task Progress",
		value: "system:task_progress",
		description: "Stream task progress events with usage stats",
	},
	{
		name: "System: Task Updated",
		value: "system:task_updated",
		description: "Stream task state update events",
	},
	{
		name: "System: Task Notification",
		value: "system:task_notification",
		description: "Stream task completion/failure/stopped notifications",
	},
	{
		name: "System: Permission Denied",
		value: "system:permission_denied",
		description: "Stream SDK permission denial messages",
	},
	{
		name: "System: Worker Shutting Down",
		value: "system:worker_shutting_down",
		description: "Stream remote worker graceful shutdown notices",
	},
	{
		name: "Prompt Suggestions",
		value: "prompt_suggestion",
		description: "Stream suggested next prompts after each turn (requires Enable Prompt Suggestions)",
	},
	// Special types
	{
		name: "Text Only",
		value: "text",
		description: "Extract and stream text deltas from stream_event (for simple text display)",
	},
	{
		name: "Structured Output (Streaming)",
		value: "structuredOutputDelta",
		description: "Stream incremental JSON chunks while structured output is being generated",
	},
	{
		name: "Structured Output",
		value: "structuredOutput",
		description: "Stream the final structured output JSON when using structured output mode",
	},
	{
		name: "Execution Metadata",
		value: "executionMetadata",
		description: "Stream execution ID and timestamp at the start of streaming",
	},
	// Interactive Approval types
	{
		name: "Permission Requests",
		value: "permission_request",
		description: "Stream permission/approval requests for tools requiring user confirmation",
	},
	{
		name: "User Questions",
		value: "ask_user_question",
		description: "Stream questions from Claude asking for user clarification",
	},
	{
		name: "Approval Responses",
		value: "approval_response",
		description: "Stream approval/denial responses after user interaction",
	},
	{
		name: "System: Hook Response",
		value: "system:hook_response",
		description: "Stream hook execution responses (SDKHookResponseMessage)",
	},
	{
		name: "System: Session State Changed",
		value: "system:session_state_changed",
		description: "Stream session state transitions (idle/running/requires_action)",
	},
	{
		name: "Tool Use Summaries",
		value: "tool_use_summary",
		description: "Stream tool use summary messages (SDKToolUseSummaryMessage)",
	},
	{
		name: "Rate Limit Events",
		value: "rate_limit_event",
		description: "Stream rate limit information events (SDKRateLimitEvent)",
	},
];
