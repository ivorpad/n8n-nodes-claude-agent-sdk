import { NodeOperationError, type IExecuteFunctions, type IWebhookFunctions } from 'n8n-workflow';

type NodeContext = Pick<IExecuteFunctions | IWebhookFunctions, 'getNode'>;

function normalizeMode(value: string | undefined): string {
	return value?.trim().toLowerCase() ?? '';
}

// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
export function isN8nQueueMode(env: NodeJS.ProcessEnv = process.env): boolean {
	return normalizeMode(env.EXECUTIONS_MODE) === 'queue'
		|| normalizeMode(env.N8N_EXECUTIONS_MODE) === 'queue';
}

export function assertStaticDataStoreQueueSafe(
	ctx: NodeContext,
	featureName: string,
	remediation: string,
): void {
	if (!isN8nQueueMode()) return;

	throw new NodeOperationError(
		ctx.getNode(),
		`${featureName} cannot use workflow static data in n8n queue mode.`,
		{ description: remediation },
	);
}
