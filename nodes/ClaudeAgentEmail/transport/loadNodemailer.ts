import { NodeOperationError } from 'n8n-workflow';
import type { IExecuteFunctions } from 'n8n-workflow';

interface NodemailerTransporterLike {
	sendMail(options: {
		from: string;
		to: string;
		subject: string;
		text: string;
		html: string;
	}): Promise<void>;
	close?: () => void;
}

interface NodemailerLike {
	createTransport(options: Record<string, unknown>): NodemailerTransporterLike;
}

let nodemailerPromise: Promise<NodemailerLike> | undefined;

export async function loadNodemailer(ctx: IExecuteFunctions): Promise<NodemailerLike> {
	if (!nodemailerPromise) {
		// Load lazily so SMTP transport code is only initialized when the Email node runs.
		nodemailerPromise = import('nodemailer') as Promise<NodemailerLike>;
	}

	try {
		return await nodemailerPromise;
	} catch (error) {
		nodemailerPromise = undefined;
		throw new NodeOperationError(
			ctx.getNode(),
			`Email transport unavailable: failed to load nodemailer. ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}
