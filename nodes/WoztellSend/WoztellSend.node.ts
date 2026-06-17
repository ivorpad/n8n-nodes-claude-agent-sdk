import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
} from 'n8n-workflow';

import { woztellSendDescription } from './node/description';
import { execute } from './node/execute';

const WOZTELL_GRAPHQL_URL = 'https://open.api.woztell.com/v3';
const META_GRAPH_API_VERSION = 'v22.0';

const GET_CHANNEL_QUERY = `query getChannel($channelId: ID) {
	apiViewer {
		channel(channelId: $channelId) {
			environments {
				integration {
					meta
				}
			}
		}
	}
}`;

export class WoztellSend implements INodeType {
	description = woztellSendDescription;

	methods = {
		loadOptions: {
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('woztellBotApi');
				const accessToken = String(
					(credentials as Record<string, unknown>)?.accessToken ?? '',
				).trim();
				let channelId = '';
				try {
					channelId = this.getNodeParameter('channelId', '') as string;
				} catch {
					/* parameter might not exist yet */
				}

				if (!accessToken || !channelId) {
					return [
						{ name: '(Configure credential & Channel ID first)', value: '' },
					];
				}

				const graphqlResponse = await this.helpers.httpRequest({
					method: 'POST',
					url: WOZTELL_GRAPHQL_URL,
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${accessToken}`,
					},
					body: {
						query: GET_CHANNEL_QUERY,
						variables: { channelId },
					},
					json: true,
				});

				const environments = (
					graphqlResponse as Record<string, unknown>
				)?.data as Record<string, unknown> | undefined;
				const apiViewer = environments?.apiViewer as Record<string, unknown> | undefined;
				const channel = apiViewer?.channel as Record<string, unknown> | undefined;
				const envList = channel?.environments as Array<Record<string, unknown>> | undefined;

				if (!Array.isArray(envList) || envList.length === 0) {
					return [{ name: '(No channel environment found)', value: '' }];
				}

				const integration = envList[0]?.integration as Record<string, unknown> | undefined;
				const meta = integration?.meta as Record<string, unknown> | undefined;
				const wabaId = meta?.wabaId as string | undefined;
				const systemUserToken = meta?.embeddedSignUpSystemUserToken as string | undefined;

				if (!wabaId || !systemUserToken) {
					return [
						{ name: '(No WABA ID or system user token in channel environment)', value: '' },
					];
				}

				const templatesResponse = await this.helpers.httpRequest({
					method: 'GET',
					url: `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${wabaId}/message_templates`,
					qs: { limit: 50, status: 'APPROVED' },
					headers: {
						Authorization: `Bearer ${systemUserToken}`,
					},
					json: true,
				});

				const templates = (templatesResponse as Record<string, unknown>)?.data as
					| Array<Record<string, unknown>>
					| undefined;

				if (!Array.isArray(templates) || templates.length === 0) {
					return [{ name: '(No approved templates found)', value: '' }];
				}

				return templates.map((t) => ({
					name: `${t.name} (${t.language})`,
					value: `${t.name}|${t.language}`,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return execute.call(this);
	}
}
