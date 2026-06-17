import { describe, expect, it } from 'vitest';

import { executeNonStreaming } from '../../operations/executeTask/execution';

function createAsyncIterable(messages: unknown[]): AsyncIterable<unknown> {
	return {
		[Symbol.asyncIterator]: async function* () {
			for (const message of messages) {
				yield message;
			}
		},
	};
}

describe('executeNonStreaming task tool tracking', () => {
	it('accumulates SDK Task tool updates by task ID', async () => {
		const result = await executeNonStreaming({
			stderrOutput: [],
			queryResult: createAsyncIterable([
				{
					type: 'assistant',
					message: {
						content: [
							{
								type: 'tool_use',
								name: 'TaskCreate',
								id: 'toolu_create',
								input: {
									id: 'task-1',
									content: 'Review the migration notes',
									status: 'pending',
								},
							},
							{
								type: 'tool_use',
								name: 'TaskUpdate',
								id: 'toolu_update',
								input: {
									id: 'task-1',
									status: 'completed',
								},
							},
						],
					},
				},
			]),
		});

		expect(result.latestTasks).toEqual([
			{
				id: 'task-1',
				content: 'Review the migration notes',
				status: 'completed',
			},
		]);
	});

	it('keeps TodoWrite snapshot parsing for historical transcripts', async () => {
		const result = await executeNonStreaming({
			stderrOutput: [],
			queryResult: createAsyncIterable([
				{
					type: 'assistant',
					message: {
						content: [
							{
								type: 'tool_use',
								name: 'TodoWrite',
								id: 'toolu_todo',
								input: {
									todos: [
										{
											content: 'Legacy todo',
											status: 'completed',
											activeForm: 'Reviewing legacy todo',
										},
									],
								},
							},
						],
					},
				},
			]),
		});

		expect(result.latestTodos).toEqual([
			{
				content: 'Legacy todo',
				status: 'completed',
				activeForm: 'Reviewing legacy todo',
			},
		]);
	});
});
