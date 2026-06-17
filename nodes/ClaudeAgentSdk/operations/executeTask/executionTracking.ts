/**
 * Message-tracking helpers for the executeTask execution loops:
 * todo/task tool tracking and assistant content extraction.
 */

import type { TaskItem, TodoItem } from '../../types';
import type { NodeStreamMessage } from '../../streaming/types';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function extractAssistantTextBlocks(message: NodeStreamMessage): string[] {
	if (message.type !== 'assistant') return [];

	const assistantMsg = asRecord(message.message);
	const content = assistantMsg?.content;
	if (!Array.isArray(content)) return [];

	const texts: string[] = [];
	for (const block of content) {
		const contentBlock = block as Record<string, unknown>;
		if (contentBlock.type === 'text' && typeof contentBlock.text === 'string') {
			texts.push(contentBlock.text);
		}
	}

	return texts;
}

interface ToolUseBlock {
	id?: string;
	name: string;
	input: Record<string, unknown>;
}

interface TaskToolInput {
	name: string;
	input: Record<string, unknown>;
}

export interface ExecutionTrackingState {
	latestTodos: TodoItem[];
	latestTasksById: Map<string, TaskItem>;
	taskToolInputsById: Map<string, TaskToolInput>;
}

export function createExecutionTrackingState(): ExecutionTrackingState {
	return {
		latestTodos: [],
		latestTasksById: new Map<string, TaskItem>(),
		taskToolInputsById: new Map<string, TaskToolInput>(),
	};
}

const TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const satisfies readonly TodoItem['status'][];

function isTodoStatus(value: unknown): value is TodoItem['status'] {
	return typeof value === 'string' && (TODO_STATUSES as readonly string[]).includes(value);
}

function normalizeTodoItems(value: unknown): TodoItem[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const todos: TodoItem[] = [];
	for (const entry of value) {
		const todo = asRecord(entry);
		if (
			!todo ||
			typeof todo.content !== 'string' ||
			!isTodoStatus(todo.status)
		) {
			return undefined;
		}
		todos.push({
			content: todo.content,
			status: todo.status,
			activeForm: typeof todo.activeForm === 'string' ? todo.activeForm : '',
		});
	}

	return todos;
}

function getAssistantToolUseBlocks(message: NodeStreamMessage): ToolUseBlock[] {
	if (message.type !== 'assistant') return [];

	const assistantMsg = asRecord(message.message);
	const content = assistantMsg?.content;
	if (!Array.isArray(content)) return [];

	return content.flatMap((contentBlock): ToolUseBlock[] => {
		const block = asRecord(contentBlock);
		if (!block || block.type !== 'tool_use' || typeof block.name !== 'string') return [];
		const input = asRecord(block.input) ?? {};
		return [{
			id: typeof block.id === 'string' ? block.id : undefined,
			name: block.name,
			input,
		}];
	});
}

function getToolUseBlocks(message: NodeStreamMessage): ToolUseBlock[] {
	// Canonical union has no top-level 'tool_use' message type — tool uses
	// only appear as assistant content blocks.
	return getAssistantToolUseBlocks(message);
}

function isTaskToolName(toolName: string): boolean {
	return (
		toolName === 'TaskCreate' ||
		toolName === 'TaskUpdate' ||
		toolName === 'TaskGet' ||
		toolName === 'TaskList'
	);
}

function readStringField(record: Record<string, unknown>, field: string): string | undefined {
	const value = record[field];
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readTaskId(record: Record<string, unknown>): string | undefined {
	return (
		readStringField(record, 'id') ??
		readStringField(record, 'taskId') ??
		readStringField(record, 'task_id')
	);
}

function normalizeTaskPatch(input: Record<string, unknown>): TaskItem | undefined {
	const nestedTask = asRecord(input.task);
	const source = nestedTask ? { ...input, ...nestedTask } : input;
	const id = readTaskId(source);
	if (!id) return undefined;

	const patch: TaskItem = { id };
	for (const [key, value] of Object.entries(source)) {
		if (key === 'id' || key === 'taskId' || key === 'task_id' || key === 'task') {
			continue;
		}
		if (value !== undefined) {
			patch[key] = value;
		}
	}

	return patch;
}

function mergeTaskPatch(state: ExecutionTrackingState, input: Record<string, unknown>): void {
	const patch = normalizeTaskPatch(input);
	if (!patch) return;
	state.latestTasksById.set(patch.id, {
		...state.latestTasksById.get(patch.id),
		...patch,
	});
}

function parseJsonLikeString(value: string): unknown {
	const trimmed = value.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

function normalizeToolResultContent(content: unknown): unknown {
	if (typeof content === 'string') {
		return parseJsonLikeString(content);
	}
	if (!Array.isArray(content)) {
		return content;
	}

	const text = content
		.map((block) => asRecord(block))
		.filter((block): block is Record<string, unknown> => Boolean(block))
		.filter((block) => block.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text as string)
		.join('\n')
		.trim();

	return text ? parseJsonLikeString(text) : content;
}

function collectToolResults(message: NodeStreamMessage): Array<{ toolUseId: string; result: unknown }> {
	// Canonical union has no top-level 'tool_result' message type — results
	// only appear as tool_result blocks inside user messages.
	if (message.type !== 'user') return [];
	const messageRecord = message as unknown as Record<string, unknown>;

	const userMessage = asRecord(message.message);
	const content = userMessage?.content;
	if (!Array.isArray(content)) return [];

	return content.flatMap((contentBlock): Array<{ toolUseId: string; result: unknown }> => {
		const block = asRecord(contentBlock);
		if (!block || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
			return [];
		}
		return [{
			toolUseId: block.tool_use_id,
			result: normalizeToolResultContent(messageRecord.tool_use_result ?? block.content),
		}];
	});
}

function trackTaskToolResult(
	state: ExecutionTrackingState,
	toolUseId: string,
	result: unknown,
): void {
	const pendingTool = state.taskToolInputsById.get(toolUseId);
	if (!pendingTool) return;

	const resultRecord = asRecord(result);
	if (!resultRecord) return;

	if (pendingTool.name === 'TaskList' && Array.isArray(resultRecord.tasks)) {
		for (const task of resultRecord.tasks) {
			const taskRecord = asRecord(task);
			if (taskRecord) {
				mergeTaskPatch(state, taskRecord);
			}
		}
		return;
	}

	if (pendingTool.name === 'TaskCreate' || pendingTool.name === 'TaskGet') {
		const taskRecord = asRecord(resultRecord.task);
		if (taskRecord) {
			mergeTaskPatch(state, { ...pendingTool.input, ...taskRecord });
		}
	}

	if (pendingTool.name === 'TaskUpdate') {
		mergeTaskPatch(state, { ...pendingTool.input, ...resultRecord });
	}
}

export function updateExecutionTracking(message: NodeStreamMessage, state: ExecutionTrackingState): void {
	for (const block of getToolUseBlocks(message)) {
		if (block.name === 'TodoWrite') {
			const todos = normalizeTodoItems(block.input.todos);
			if (todos) {
				state.latestTodos = todos;
			}
		}

		if (isTaskToolName(block.name)) {
			mergeTaskPatch(state, block.input);
			if (block.id) {
				state.taskToolInputsById.set(block.id, {
					name: block.name,
					input: block.input,
				});
			}
		}
	}

	for (const result of collectToolResults(message)) {
		trackTaskToolResult(state, result.toolUseId, result.result);
	}
}
