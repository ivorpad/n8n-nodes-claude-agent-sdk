import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

const WOZTELL_BOT_BASE_URL = 'https://bot.api.woztell.com';

interface WoztellCredentials {
	accessToken: string;
}

function sanitizeRecipientId(value: string): string {
	return value.replace(/[-()+ \s]/g, '');
}

async function getCredentialToken(ctx: IExecuteFunctions): Promise<string> {
	const credentials = await ctx.getCredentials<WoztellCredentials>('woztellBotApi');
	const accessToken = String(credentials?.accessToken ?? '').trim();
	if (!accessToken) {
		throw new NodeOperationError(ctx.getNode(), 'Woztell credential is missing Access Token');
	}
	return accessToken;
}

export async function sendResponses(
	ctx: IExecuteFunctions,
	channelId: string,
	recipientId: string,
	responsePayload: Record<string, unknown>[],
): Promise<Record<string, unknown>> {
	const accessToken = await getCredentialToken(ctx);
	const sanitizedRecipient = sanitizeRecipientId(recipientId);

	const response = await ctx.helpers.httpRequest({
		method: 'POST',
		url: `${WOZTELL_BOT_BASE_URL}/sendResponses`,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
		},
		body: {
			channelId,
			recipientId: sanitizedRecipient,
			response: responsePayload,
		},
		json: true,
	});

	const data = typeof response === 'object' && response !== null
		? (response as Record<string, unknown>)
		: {};

	if (data.ok !== 1) {
		const errMsg = typeof data.error === 'string' ? data.error : 'Unknown Woztell API error';
		throw new NodeOperationError(ctx.getNode(), `Woztell Bot API error: ${errMsg}`);
	}

	return data;
}
