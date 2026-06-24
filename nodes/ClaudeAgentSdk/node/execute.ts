import type { EngineRequest, EngineResponse, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { executeTaskOperation } from '../operations/executeTask';
import { generatePythonSdkScript } from '../operations/generatePythonSdk';
import { managedAgentLifecycleOperation } from '../operations/managedAgentLifecycle';
import { createSdkAdapter, loadClaudeAgentSdkModule } from '../sdk';
import type { ClaudeAgentSdkModule, SdkAdapter } from '../sdk';
import { ManagedAgentAdapter } from '../managedAgent';
import {
	parseCommaSeparatedIds,
	parseManagedSessionResources,
	parseMetadataJson,
	parsePositiveInteger,
} from '../managedAgent/configuration';

import {
	getErrorDescription,
	getErrorDetails,
	getErrorMessage,
	setExecutionContext,
} from './errors';
import { isNodeCredentialType, resolveAuthMethod } from '../authMethod';
import type { AuthMethod } from '../authMethod';
import { loadCodeMieCompanion } from '../codemie/companion';
import { debugError } from '../diagnostics';

type OptionalCredentialKey =
	| 'claudeApi'
	| 'anthropicApi'
	| 'openRouterApi'
	| 'claudeAgentSdkOpenRouterApi'
	| 'alibabaCodingPlanApi'
	| 'claudeAgentSdkLiteLlmApi'
	| 'codeMieSsoApi';

interface LoadedAuthValues {
	apiKey?: string;
	anthropicBaseUrl?: string;
	openrouterAuthToken?: string;
	openrouterBaseUrl?: string;
	ollamaAuthToken?: string;
	ollamaBaseUrl?: string;
	alibabaAuthToken?: string;
	alibabaBaseUrl?: string;
	liteLlmAuthToken?: string;
	liteLlmBaseUrl?: string;
	codeMieBaseUrl?: string;
	codeMieAuthToken?: string;
}

function validateSelectedCredentialType(
	ctx: IExecuteFunctions,
	authentication: string,
	nodeCredentialType: string,
): void {
	if (authentication !== 'predefinedCredentialType' || isNodeCredentialType(nodeCredentialType)) {
		return;
	}

	const supportedCredentialTypes =
		'Claude Agent SDK Anthropic API, Claude Agent SDK OpenRouter API, Alibaba Coding Plan API, or Claude Agent SDK LiteLLM API';
	const selectedCredentialType = nodeCredentialType.trim();
	const message = selectedCredentialType
		? `Credential Type "${selectedCredentialType}" is not supported by Claude Agent SDK. Select ${supportedCredentialTypes}.`
		: `Select ${supportedCredentialTypes} in Credential Type before executing.`;

	throw new NodeOperationError(ctx.getNode(), message);
}

function formatCredentialLoadError(error: unknown): string {
	const baseMessage = error instanceof Error ? error.message : String(error);
	if (/Unrecognized credential type:/i.test(baseMessage)) {
		return (
			`${baseMessage}. ` +
			'This credential type is not registered in the running n8n process yet. ' +
			'Rebuild/restart custom nodes (`pnpm build`, then restart n8n), reopen the workflow, and reselect the credential.'
		);
	}
	return baseMessage;
}

async function tryLoadOptionalCredential<T>(
	ctx: IExecuteFunctions,
	credentialKey: OptionalCredentialKey,
	buildErrorMessage: (error: unknown) => string,
): Promise<T | undefined> {
	const hasCredentialConfigured = Boolean(
		(ctx.getNode().credentials as Record<string, unknown> | undefined)?.[credentialKey],
	);

	try {
		return await ctx.getCredentials(credentialKey) as T;
	} catch (error) {
		if (hasCredentialConfigured) {
			throw new NodeOperationError(ctx.getNode(), buildErrorMessage(error));
		}
		return undefined;
	}
}

async function loadAuthValues(
	ctx: IExecuteFunctions,
	authMethod: AuthMethod,
	authentication: string,
	nodeCredentialType: string,
): Promise<LoadedAuthValues> {
	if (authMethod === 'apiCredentials') {
		const credentialKey = nodeCredentialType === 'anthropicApi' ? 'anthropicApi' : 'claudeApi';
		const credentials = await tryLoadOptionalCredential<{
			authType?: 'apiKey' | 'cliExecutable';
			apiKey?: string;
			executablePath?: string;
			baseUrl?: string;
			url?: string;
		}>(
			ctx,
			credentialKey,
			(error) => `Failed to load Claude credentials. ${formatCredentialLoadError(error)}`,
		);

		if (credentials?.authType !== 'cliExecutable' && credentials?.apiKey) {
			return {
				apiKey: credentials.apiKey,
				anthropicBaseUrl: credentials.baseUrl || credentials.url,
			};
		}
		return {};
	}

	if (authMethod === 'openrouter') {
		// SDK-owned credential by default; the legacy n8n LangChain
		// 'openRouterApi' type only for saves that explicitly used it — the
		// legacy selector value or the pre-selector 'openrouter' authentication.
		const usesLegacyOpenRouterCredential =
			nodeCredentialType === 'openRouterApi' ||
			(authentication === 'openrouter' && nodeCredentialType !== 'claudeAgentSdkOpenRouterApi');
		const credentialKey = usesLegacyOpenRouterCredential
			? 'openRouterApi'
			: 'claudeAgentSdkOpenRouterApi';
		const credentials = await tryLoadOptionalCredential<{
			apiKey?: string;
			authToken?: string;
			baseUrl?: string;
			url?: string;
		}>(
			ctx,
			credentialKey,
			(error) => `Failed to load OpenRouter credentials. ${formatCredentialLoadError(error)}`,
		);

		const resolvedApiKey = credentials?.apiKey || credentials?.authToken;
		return {
			openrouterAuthToken: resolvedApiKey,
			openrouterBaseUrl: credentials?.baseUrl || credentials?.url,
		};
	}

	if (authMethod === 'alibaba') {
		const credentials = await tryLoadOptionalCredential<{
			apiKey?: string;
			authToken?: string;
			baseUrl?: string;
		}>(
			ctx,
			'alibabaCodingPlanApi',
			(error) => `Failed to load Alibaba Coding Plan credentials. ${formatCredentialLoadError(error)}`,
		);

		const resolvedApiKey = credentials?.apiKey || credentials?.authToken;
		return {
			alibabaAuthToken: resolvedApiKey,
			alibabaBaseUrl: credentials?.baseUrl,
		};
	}

	if (authMethod === 'litellm') {
		const credentials = await tryLoadOptionalCredential<{
			apiKey?: string;
			authToken?: string;
			baseUrl?: string;
			url?: string;
		}>(
			ctx,
			'claudeAgentSdkLiteLlmApi',
			(error) => `Failed to load LiteLLM credentials. ${formatCredentialLoadError(error)}`,
		);

		const resolvedApiKey = credentials?.apiKey || credentials?.authToken;
		return {
			liteLlmAuthToken: resolvedApiKey,
			liteLlmBaseUrl: credentials?.baseUrl || credentials?.url,
		};
	}

	if (authMethod === 'codemie') {
		// The CodeMie SSO credential holds the instance URL + pasted token; the
		// SSO session itself lives in the proxy daemon's encrypted store. Here we
		// just resolve the running proxy (start/reuse) via the companion package
		// and surface its loopback URL + gateway key as the provider auth values.
		const credentials = await tryLoadOptionalCredential<{ instanceUrl?: string }>(
			ctx,
			'codeMieSsoApi',
			(error) => `Failed to load CodeMie SSO credentials. ${formatCredentialLoadError(error)}`,
		);
		const instanceUrl = (credentials?.instanceUrl || '').trim();
		if (!instanceUrl) {
			throw new NodeOperationError(
				ctx.getNode(),
				'CodeMie Proxy requires an Instance URL in the CodeMie SSO credential.',
			);
		}
		const proxy = await loadCodeMieCompanion().ensureCodemieProxy({ instanceUrl });
		return {
			codeMieBaseUrl: proxy.url,
			codeMieAuthToken: proxy.gatewayKey,
		};
	}

	return {};
}

const GENERATE_PYTHON_LOOPBACK_TYPES = new Set([
	'python_sdk_script',
	'task_result',
	'approval_request',
	'question_request',
	'approval_response',
	'question_response',
]);

function isGeneratePythonLoopbackPayload(itemJson: Record<string, unknown> | undefined): boolean {
	if (!itemJson) return false;
	const type = itemJson.type;
	return typeof type === 'string' && GENERATE_PYTHON_LOOPBACK_TYPES.has(type);
}

function isTerminalQuestionResponse(itemJson: Record<string, unknown> | undefined): boolean {
	if (!itemJson) return false;
	return itemJson.type === 'question_response' && itemJson.responseAction === 'complete';
}

function isExecuteTaskLoopbackPayload(itemJson: Record<string, unknown> | undefined): boolean {
	if (!itemJson) return false;
	return itemJson.type === 'task_result' || isTerminalQuestionResponse(itemJson);
}

function hasAuditLoggingOutputEnabled(ctx: IExecuteFunctions): boolean {
	const secOpts = ctx.getNodeParameter('securityOptions', 0, {}) as Record<string, unknown>;
	const auditLogging = secOpts.auditLogging as Record<string, unknown> | undefined;
	const auditSettings = auditLogging?.settings as Record<string, unknown> | undefined;
	return auditSettings?.enabled === true;
}

export async function execute(
	this: IExecuteFunctions,
	response?: EngineResponse,
): Promise<INodeExecutionData[][] | EngineRequest> {
	const items = this.getInputData();
	const operation = this.getNodeParameter('operation', 0, 'executeTask') as string;

	// Skip internal loopback payloads so HITL completions do not regenerate themselves.
	if (operation === 'generatePythonSdk') {
		const scriptResults: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			const itemJson = items[i]?.json as Record<string, unknown> | undefined;
			if (isGeneratePythonLoopbackPayload(itemJson)) {
				continue;
			}
			scriptResults.push(generatePythonSdkScript(this, i));
		}
		return [scriptResults];
	}

	// Pass completed task results through without re-executing Claude.
	if (
		operation === 'executeTask' &&
		items.length > 0 &&
		items.every((item) => isExecuteTaskLoopbackPayload(item.json as Record<string, unknown> | undefined))
	) {
		const outputs: INodeExecutionData[][] = [items];
		if (hasAuditLoggingOutputEnabled(this)) outputs.push([]);
		return outputs;
	}

	const returnData: INodeExecutionData[] = [];
	const auditLogData: INodeExecutionData[] = [];
	let hasAuditLoggingEnabled = false;

	let secureEnv: Record<string, string> | undefined;
	const authentication = String(this.getNodeParameter('authentication', 0, 'claudeApi'));
	const nodeCredentialType = String(this.getNodeParameter('nodeCredentialType', 0, 'claudeApi'));
	validateSelectedCredentialType(this, authentication, nodeCredentialType);
	const authMethod = resolveAuthMethod(authentication, nodeCredentialType);
	const loadedAuthValues = await loadAuthValues(this, authMethod, authentication, nodeCredentialType);
	const {
		apiKey,
		anthropicBaseUrl,
		openrouterAuthToken,
		openrouterBaseUrl,
		ollamaAuthToken,
		ollamaBaseUrl,
		alibabaAuthToken,
		alibabaBaseUrl,
		liteLlmAuthToken,
		liteLlmBaseUrl,
		codeMieBaseUrl,
		codeMieAuthToken,
	} = loadedAuthValues;

	if (operation === 'manageManagedAgent') {
		if (!apiKey) {
			throw new NodeOperationError(
				this.getNode(),
				'Managed Agent operations require an Anthropic API key. Configure one in the Claude API credential.',
			);
		}
		const managedResults: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			managedResults.push(await managedAgentLifecycleOperation({
				execFunctions: this,
				itemIndex: i,
				apiKey,
			}));
		}
		return [managedResults];
	}

	const secureEnvCredentialConfigured = Boolean(
		(this.getNode().credentials as Record<string, unknown> | undefined)?.secureEnvVarsApi,
	);
	if (secureEnvCredentialConfigured) {
		const secureEnvCredentials = await this.getCredentials('secureEnvVarsApi') as {
			vars?: {
				values?: Array<{
					key?: string;
					value?: string;
				}>;
			};
		};

		if (secureEnvCredentials?.vars?.values?.length) {
			const ENV_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
			const resolved: Record<string, string> = {};

			for (const entry of secureEnvCredentials.vars.values) {
				if (!entry) continue;
				const key = (entry.key ?? '').trim();
				const value = entry.value ?? '';
				if (!key) continue;
				if (!ENV_NAME_REGEX.test(key)) {
					throw new NodeOperationError(
						this.getNode(),
						`Invalid secure environment variable name "${key}". Must match ^[A-Za-z_][A-Za-z0-9_]*$.`,
					);
				}
				resolved[key] = value;
			}

			if (Object.keys(resolved).length > 0) {
				secureEnv = resolved;
			}
		}
	}

	let sdkModule: ClaudeAgentSdkModule | undefined;

	for (let i = 0; i < items.length; i++) {
		try {
			const item = items[i];
			if (
				operation === 'executeTask' &&
				isExecuteTaskLoopbackPayload(item?.json as Record<string, unknown> | undefined)
			) {
				if (item) returnData.push(item);
				continue;
			}

			const backendMode = this.getNodeParameter('backendMode', i, 'localCli') as
				| 'localCli'
				| 'managedAgent';

			let adapter: SdkAdapter;
			if (backendMode === 'managedAgent') {
				if (!apiKey) {
					throw new NodeOperationError(
						this.getNode(),
						'Managed Agent backend requires an Anthropic API key. Configure one in the Claude API credential.',
						{ itemIndex: i },
					);
				}
				const managedAgentId = (this.getNodeParameter('managedAgentId', i, '') as string).trim() || undefined;
				const managedEnvironmentId = (this.getNodeParameter('managedEnvironmentId', i, '') as string).trim() || undefined;
				const managedAgentVersionMode = this.getNodeParameter('managedAgentVersionMode', i, 'latest') as string;
				const managedAgentVersion = managedAgentVersionMode === 'pinned'
					? parsePositiveInteger(
						this.getNodeParameter('managedAgentVersion', i, 1) as number,
						'Pinned Agent Version',
					)
					: undefined;
				const managedSessionTitle = (this.getNodeParameter('managedSessionTitle', i, '') as string).trim() || undefined;
				const managedSessionMetadata = parseMetadataJson(
					this.getNodeParameter('managedSessionMetadataJson', i, '') as string,
					'Session Metadata JSON',
				);
				const managedVaultIds = parseCommaSeparatedIds(
					this.getNodeParameter('managedVaultIds', i, '') as string,
				);
				const managedResources = parseManagedSessionResources(
					this.getNodeParameter('managedSessionResources', i, {}),
				);
				if (!managedAgentId) {
					throw new NodeOperationError(
						this.getNode(),
						'Managed Agent backend requires an agent. Pick one from the Agent dropdown, or create one at https://platform.claude.com/workspaces/default/agents and paste the ID.',
						{ itemIndex: i },
					);
				}
				if (!managedEnvironmentId) {
					throw new NodeOperationError(
						this.getNode(),
						'Managed Agent backend requires an environment. Pick one from the Environment dropdown, or create one at https://platform.claude.com/workspaces/default/agents.',
						{ itemIndex: i },
					);
				}
				adapter = new ManagedAgentAdapter({
					apiKey,
					agentId: managedAgentId,
					agentVersion: managedAgentVersion,
					environmentId: managedEnvironmentId,
					sessionTitle: managedSessionTitle,
					sessionMetadata: managedSessionMetadata,
					vaultIds: managedVaultIds,
					resources: managedResources,
				});
			} else {
				if (!sdkModule) {
					sdkModule = await loadClaudeAgentSdkModule();
				}
				adapter = createSdkAdapter(sdkModule, 'v1');
			}

				const selectedOllamaModel = authMethod === 'ollama'
					? (this.getNodeParameter('ollamaModel', i, '') as string).trim()
					: undefined;
				const selectedLiteLlmModel = authMethod === 'litellm'
					? (
						(this.getNodeParameter('liteLlmModelAlias', i, '') as string).trim() ||
						(this.getNodeParameter('liteLlmModel', i, '') as string).trim()
					)
					: undefined;
				const selectedCodeMieModel = authMethod === 'codemie'
					? (
						(this.getNodeParameter('codeMieModelManual', i, '') as string).trim() ||
						(this.getNodeParameter('codeMieModel', i, '') as string).trim()
					)
					: undefined;
			setExecutionContext({
				provider: authMethod === 'ollama' ? 'ollama' : authMethod === 'openrouter' ? 'openrouter' : authMethod === 'alibaba' ? 'alibaba' : authMethod === 'litellm' ? 'litellm' : authMethod === 'codemie' ? 'codemie' : 'anthropic',
				model: selectedOllamaModel || selectedLiteLlmModel || selectedCodeMieModel || undefined,
			});

			const result = await executeTaskOperation(this, i, {
				apiKey,
				anthropicBaseUrl,
				openrouterAuthToken,
				openrouterBaseUrl,
				ollamaAuthToken,
				ollamaBaseUrl,
				alibabaAuthToken,
				alibabaBaseUrl,
				liteLlmAuthToken,
				liteLlmBaseUrl,
				codeMieBaseUrl,
				codeMieAuthToken,
				secureEnv,
				authMethod,
				adapter,
				backendMode,
				sdkModule: backendMode === 'localCli' ? sdkModule : undefined,
				engineResponse: response,
			});

				if ('actions' in result) {
					return result as EngineRequest;
				}

			auditLogData.push(...result.auditLogData);

			if (result.hasAuditLogging) {
				hasAuditLoggingEnabled = true;
			}

				if (result.agentError) {
					const dataWithError: INodeExecutionData = {
					json: {
						...result.returnData.json,
						error: result.agentError.message,
					},
					pairedItem: result.returnData.pairedItem,
					};

					if (this.continueOnFail()) {
						returnData.push(dataWithError);
						continue;
					}
					throw new NodeOperationError(
						this.getNode(),
						result.agentError.message,
					{ itemIndex: i },
				);
			}

			returnData.push(result.returnData);
			if (result.extraReturnItems?.length) {
				returnData.push(...result.extraReturnItems);
			}
			} catch (error) {
				debugError('[Claude Agent SDK] Error executing task:', {
				message: error instanceof Error ? error.message : String(error),
				name: error instanceof Error ? error.name : undefined,
				code: (error as NodeJS.ErrnoException)?.code,
				path: (error as NodeJS.ErrnoException)?.path,
				syscall: (error as NodeJS.ErrnoException)?.syscall,
				stack: error instanceof Error ? error.stack : undefined,
				raw: error,
			});

				if (error instanceof NodeOperationError) {
					throw error;
				}

				const errorMessage = getErrorMessage(error);

			if (this.continueOnFail()) {
				returnData.push({
					json: {
						error: errorMessage,
						errorDetails: getErrorDetails(error),
					},
					pairedItem: { item: i },
				});
				continue;
			}

				throw new NodeOperationError(
					this.getNode(),
					errorMessage,
				{
					itemIndex: i,
					description: getErrorDescription(error),
				},
			);
		}
	}

	const outputs: INodeExecutionData[][] = [returnData];
	if (hasAuditLoggingEnabled) {
		outputs.push(auditLogData);
	}
	return outputs;
}
