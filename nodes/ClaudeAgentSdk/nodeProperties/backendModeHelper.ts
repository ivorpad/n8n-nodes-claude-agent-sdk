import type { INodeProperties } from 'n8n-workflow';

/**
 * Wrap properties so they only render when `backendMode=localCli`.
 *
 * Managed Agents run inside Anthropic's hosted infrastructure, so every
 * local-CLI concept (sandbox, working directory, local MCP stdio, plugins,
 * hook handlers, provider selection, etc.) is meaningless there.
 * Rather than sprinkling `displayOptions.show.backendMode = ['localCli']`
 * on every field, each local-only property module is piped through this
 * helper at the composition step.
 *
 * Existing `displayOptions.show` conditions are preserved — the new
 * `backendMode` constraint is AND-ed with anything already present.
 */
export function localCliOnly(props: INodeProperties[]): INodeProperties[] {
	return props.map(gateLocalCli);
}

export function operationOnly(
	props: INodeProperties[],
	operations: string[],
): INodeProperties[] {
	return props.map((prop) => ({
		...prop,
		displayOptions: {
			...prop.displayOptions,
			show: {
				...(prop.displayOptions?.show ?? {}),
				operation: operations,
			},
		},
	}));
}

export function gateLocalCli(prop: INodeProperties): INodeProperties {
	return {
		...prop,
		displayOptions: {
			...prop.displayOptions,
			show: {
				...(prop.displayOptions?.show ?? {}),
				operation: ['executeTask', 'generatePythonSdk'],
				backendMode: ['localCli'],
			},
		},
	};
}
