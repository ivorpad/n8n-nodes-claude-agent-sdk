import * as fs from 'node:fs';

import { findSessionTranscriptPath } from '../sessionDirectory';
import type { SecretsRedactor } from '../secretsRedaction';

export interface DurableFullSessionContent {
	sessionContent: string;
	messageCount: number;
	source: 'claudeTranscript' | 'executionMessages';
	transcriptPath?: string;
}

function uniqueSessionIds(values: Array<string | undefined>): string[] {
	return [...new Set(
		values
			.map((value) => value?.trim())
			.filter((value): value is string => Boolean(value)),
	)];
}

function countJsonlMessages(content: string): number {
	return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function serializeJsonl(messages: unknown[]): string {
	return messages
		.map((message) => JSON.stringify(message))
		.filter((line): line is string => typeof line === 'string')
		.join('\n');
}

export function resolveDurableFullSessionContent(args: {
	claudeConfigDirectory: string;
	sessionIds: Array<string | undefined>;
	fallbackMessages: unknown[];
	secretRedactor: SecretsRedactor;
}): DurableFullSessionContent {
	const {
		claudeConfigDirectory,
		sessionIds,
		fallbackMessages,
		secretRedactor,
	} = args;

	for (const sessionId of uniqueSessionIds(sessionIds)) {
		const transcriptPath = findSessionTranscriptPath({
			claudeConfigDirectory,
			sessionId,
		});
		if (!transcriptPath) {
			continue;
		}

		try {
			const rawContent = fs.readFileSync(transcriptPath, 'utf8');
			const sessionContent = secretRedactor.hasSecrets
				? secretRedactor.redactString(rawContent)
				: rawContent;
			const messageCount = countJsonlMessages(sessionContent);
			if (messageCount > 0) {
				return {
					sessionContent,
					messageCount,
					source: 'claudeTranscript',
					transcriptPath,
				};
			}
		} catch {
			continue;
		}
	}

	const redactedMessages = secretRedactor.hasSecrets
		? secretRedactor.redactUnknown(fallbackMessages)
		: fallbackMessages;

	return {
		sessionContent: serializeJsonl(redactedMessages),
		messageCount: redactedMessages.length,
		source: 'executionMessages',
	};
}
