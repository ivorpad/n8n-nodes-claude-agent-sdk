/**
 * Compile-time SDK parity assertions.
 *
 * This file intentionally has no runtime behavior. It is compiled by
 * tsconfig.parity.json to fail fast when the upstream SDK contract drifts.
 */

import type {
	ClaudeAgentSdkModule,
	UpstreamCreateSdkMcpServer,
	UpstreamQueryOptions,
	UpstreamSdkModule,
	UpstreamTool,
} from './types';
import type {
	TaskCreateInput,
	TaskGetInput,
	TaskListInput,
	TaskUpdateInput,
} from '@anthropic-ai/claude-agent-sdk/sdk-tools';

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type IsFunction<T> = T extends (...args: never[]) => unknown ? true : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

export type SdkParityAssertions = [
	// Required V1 surface
	Assert<IsFunction<UpstreamSdkModule['query']>>,
	Assert<
		IsAssignable<
			Parameters<ClaudeAgentSdkModule['query']>[0],
			Parameters<UpstreamSdkModule['query']>[0]
		>
	>,
	Assert<
		IsAssignable<
			Parameters<UpstreamSdkModule['query']>[0],
			Parameters<ClaudeAgentSdkModule['query']>[0]
		>
	>,
	Assert<IsAssignable<ReturnType<UpstreamSdkModule['query']>, AsyncIterable<unknown>>>,
	Assert<
		IsAssignable<ReturnType<ClaudeAgentSdkModule['query']>, ReturnType<UpstreamSdkModule['query']>>
	>,

	// SDK 0.3.142 removed the unstable V2 session surface. If these keys return,
	// the adapter and deterministic resume rules need a deliberate review.
	Assert<HasKey<UpstreamSdkModule, 'unstable_v2_createSession'> extends false ? true : false>,
	Assert<HasKey<UpstreamSdkModule, 'unstable_v2_resumeSession'> extends false ? true : false>,
	Assert<HasKey<UpstreamSdkModule, 'unstable_v2_prompt'> extends false ? true : false>,
	Assert<HasKey<ClaudeAgentSdkModule, 'unstable_v2_createSession'> extends false ? true : false>,
	Assert<HasKey<ClaudeAgentSdkModule, 'unstable_v2_resumeSession'> extends false ? true : false>,
	Assert<HasKey<ClaudeAgentSdkModule, 'unstable_v2_prompt'> extends false ? true : false>,

	// Current reasoning controls used by query setup
	Assert<IsAssignable<{ thinking: { type: 'adaptive' } }, Partial<UpstreamQueryOptions>>>,
	Assert<IsAssignable<{ effort: 'high' }, Partial<UpstreamQueryOptions>>>,

	// Current Task tool schemas replace TodoWrite for new task plans.
	Assert<IsAssignable<TaskCreateInput, { subject: string; description: string }>>,
	Assert<IsAssignable<TaskUpdateInput, { taskId: string }>>,
	Assert<IsAssignable<TaskGetInput, { taskId: string }>>,
	Assert<IsAssignable<TaskListInput, object>>,

	// MCP helpers used by n8n MCP integration
	Assert<IsAssignable<NonNullable<ClaudeAgentSdkModule['tool']>, UpstreamTool>>,
	Assert<
		IsAssignable<
			NonNullable<ClaudeAgentSdkModule['createSdkMcpServer']>,
			UpstreamCreateSdkMcpServer
		>
	>,
];
