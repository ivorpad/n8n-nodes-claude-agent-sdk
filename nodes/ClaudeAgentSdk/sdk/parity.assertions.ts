/**
 * Compile-time SDK parity assertions.
 *
 * This file intentionally has no runtime behavior. It is compiled by
 * tsconfig.parity.json to fail fast when the upstream SDK contract drifts.
 */

import type {
	ClaudeAgentSdkModule,
	BaseHookInput,
	ModelInfo,
	QueryHandle,
	SandboxCredentialsConfig,
	SandboxSettings,
	SDKInformationalMessage,
	SDKMessage,
	SDKModelRefusalNoFallbackMessage,
	SDKPermissionDeniedMessage,
	SDKRateLimitInfo,
	SDKWorkerShuttingDownMessage,
	UpstreamCreateSdkMcpServer,
	UpstreamQueryOptions,
	UpstreamSdkModule,
	UpstreamTool,
} from './types';
import type {
	AgentInput,
	AgentOutput,
	ArtifactInput,
	GlobOutput,
	MonitorInput,
	NotebookEditOutput,
	ReadMcpResourceDirInput,
	ReadMcpResourceDirOutput,
	ReportFindingsInput,
	ReportFindingsOutput,
	TaskCreateInput,
	TaskGetInput,
	TaskListInput,
	TaskUpdateInput,
} from '@anthropic-ai/claude-agent-sdk/sdk-tools';

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type IsFunction<T> = T extends (...args: never[]) => unknown ? true : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type QuerySetMaxThinkingTokens = NonNullable<QueryHandle['setMaxThinkingTokens']>;
type QuerySetMcpPermissionModeOverride = NonNullable<QueryHandle['setMcpPermissionModeOverride']>;
type QueryReinitialize = NonNullable<QueryHandle['reinitialize']>;

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
	Assert<IsAssignable<{ model: 'claude-sonnet-5' }, Partial<UpstreamQueryOptions>>>,
	Assert<HasKey<ModelInfo, 'resolvedModel'>>,

	// Current query controls exposed by the canonical upstream Query handle.
	Assert<IsFunction<QuerySetMcpPermissionModeOverride>>,
	Assert<
		IsAssignable<
			Parameters<QuerySetMcpPermissionModeOverride>,
			[serverName: string, mode: 'default' | 'auto' | null]
		>
	>,
	Assert<IsFunction<QuerySetMaxThinkingTokens>>,
	Assert<
		IsAssignable<
			Parameters<QuerySetMaxThinkingTokens>,
			[maxThinkingTokens: number | null, thinkingDisplay?: 'summarized' | 'omitted' | null]
		>
	>,
	Assert<IsFunction<QueryReinitialize>>,
	Assert<HasKey<QueryHandle, 'rewindFiles'>>,

	// Hooks carry prompt_id for prompt-grain telemetry correlation.
	Assert<HasKey<BaseHookInput, 'prompt_id'>>,

	// Current Task tool schemas replace TodoWrite for new task plans.
	Assert<IsAssignable<TaskCreateInput, { subject: string; description: string }>>,
	Assert<IsAssignable<TaskUpdateInput, { taskId: string }>>,
	Assert<IsAssignable<TaskGetInput, { taskId: string }>>,
	Assert<IsAssignable<TaskListInput, object>>,

	// SDK 0.3.176+ tool/schema drift that n8n passes through by canonical type.
	Assert<IsAssignable<ReadMcpResourceDirInput, { server: string; uri: string }>>,
	Assert<
		IsAssignable<
			{
				resources: [{ uri: 'mcp://example/dir/file'; name: 'file'; mimeType: 'text/plain' }];
			},
			ReadMcpResourceDirOutput
		>
	>,
	Assert<
		IsAssignable<
			{
				findings: [{
					file: 'nodes/example.ts';
					summary: 'Wrong value returned';
					failure_scenario: 'Input A returns B instead of C';
					verdict: 'CONFIRMED';
				}];
				level: 'high';
			},
			ReportFindingsInput
		>
	>,
	Assert<
		IsAssignable<
			{
				count: 1;
				findings: [{
					file: 'nodes/example.ts';
					summary: 'Wrong value returned';
					failure_scenario: 'Input A returns B instead of C';
				}];
			},
			ReportFindingsOutput
		>
	>,
	Assert<
		IsAssignable<
			{ description: 'events'; timeout_ms: 300000; persistent: true; ws: { url: 'wss://example.test/events' } },
			MonitorInput
		>
	>,
	Assert<
		IsAssignable<
			{ file_path: 'report.html'; favicon: 'R'; description: 'Review report'; force: true },
			ArtifactInput
		>
	>,
	Assert<
		IsAssignable<
			{ description: 'review'; prompt: 'review this'; isolation: 'remote' },
			AgentInput
		>
	>,
	Assert<
		IsAssignable<
			{
				status: 'remote_launched';
				taskId: 'task_1';
				sessionUrl: 'https://claude.ai/session/task_1';
				description: 'review';
				prompt: 'review this';
				outputFile: '/tmp/agent.txt';
			},
			AgentOutput
		>
	>,
	Assert<
		IsAssignable<
			{
				durationMs: 1;
				numFiles: 1;
				filenames: ['nodes/example.ts'];
				truncated: false;
				totalMatches: 1;
				countIsComplete: true;
			},
			GlobOutput
		>
	>,
	Assert<HasKey<NotebookEditOutput, 'old_source'>>,

	// Sandbox additions: credential denials, filesystem/network additions, and
	// Apple Events gating should stay canonical upstream option shapes.
	Assert<
		IsAssignable<
			{
				files: [{ path: '~/.aws/credentials'; mode: 'deny' }];
				envVars: [{ name: 'AWS_SECRET_ACCESS_KEY'; mode: 'deny' }];
			},
			SandboxCredentialsConfig
		>
	>,
	Assert<
		IsAssignable<
			{
				enabled: true;
				allowAppleEvents: true;
				credentials: {
					files: [{ path: '~/.aws/credentials'; mode: 'deny' }];
					envVars: [{ name: 'AWS_SECRET_ACCESS_KEY'; mode: 'deny' }];
				};
				network: {
					allowedDomains: ['api.github.com'];
					deniedDomains: ['169.254.169.254'];
					allowManagedDomainsOnly: true;
					allowMachLookup: ['com.apple.security'];
				};
				filesystem: {
					allowRead: ['/workspace'];
					denyRead: ['/workspace/.env'];
					allowManagedReadPathsOnly: true;
				};
			},
			SandboxSettings
		>
	>,
	Assert<IsAssignable<{ sandbox: SandboxSettings }, Partial<UpstreamQueryOptions>>>,

	// Streaming/output UX additions that should remain in SDKMessage.
	Assert<IsAssignable<SDKInformationalMessage, SDKMessage>>,
	Assert<IsAssignable<SDKModelRefusalNoFallbackMessage, SDKMessage>>,
	Assert<IsAssignable<SDKWorkerShuttingDownMessage, SDKMessage>>,
	Assert<HasKey<SDKPermissionDeniedMessage, 'decision_reason_type'>>,
	Assert<HasKey<SDKPermissionDeniedMessage, 'decision_reason'>>,
	Assert<
		IsAssignable<
			{
				status: 'allowed';
				rateLimitType: 'seven_day_overage_included';
				errorCode: 'credits_required';
				canUserPurchaseCredits: true;
				hasChargeableSavedPaymentMethod: false;
			},
			SDKRateLimitInfo
		>
	>,

	// MCP helpers used by n8n MCP integration
	Assert<IsAssignable<NonNullable<ClaudeAgentSdkModule['tool']>, UpstreamTool>>,
	Assert<
		IsAssignable<
			NonNullable<ClaudeAgentSdkModule['createSdkMcpServer']>,
			UpstreamCreateSdkMcpServer
		>
	>,
];
