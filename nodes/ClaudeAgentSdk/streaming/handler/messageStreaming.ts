import type {
	NodeStreamMessage,
	JsonMessageContent,
	StreamContentType,
	StreamItemPayload,
	StreamingConfig,
} from '../types';

export function streamJsonMessageImpl(args: {
	config: StreamingConfig;
	message: Record<string, unknown>;
	stream: (content: string) => void;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	formatMarker: (markerTemplate: string, context: Record<string, unknown>) => string;
}): void {
	const { config, message, stream, emitJson, formatMarker } = args;

	const messageType = message.type as string;
	const shouldStreamAll = config.contentTypes.has('allJson');
	const shouldStreamByType =
		(messageType === 'assistant' && config.contentTypes.has('assistant')) ||
		(messageType === 'user' && config.contentTypes.has('user'));

	if (!shouldStreamAll && !shouldStreamByType) {
		return;
	}

	if (config.useMarkers) {
		const startMarker = formatMarker(config.markers.jsonMsgStart, {
			type: message.type as string,
			subtype: message.subtype as string,
		});

		stream(`\n${startMarker}${JSON.stringify(message)}${config.markers.jsonMsgEnd}\n`);
	} else {
		const content: JsonMessageContent = {
			type: 'json_message',
			messageType: message.type as string,
			...(message.subtype ? { subtype: message.subtype as string } : {}),
			message,
		};
		emitJson(content);
	}
}

export function shouldStreamSdkMessage(args: {
	config: Pick<StreamingConfig, 'contentTypes'>;
	message: NodeStreamMessage;
}): boolean {
	const { config, message } = args;
	const messageRecord = message as unknown as Record<string, unknown>;
	const type = message.type;
	const subtype = typeof messageRecord.subtype === 'string' ? messageRecord.subtype : undefined;

	// Check 'all' first - streams everything
	if (config.contentTypes.has('all')) {
		return true;
	}

	// Check specific type
	if (config.contentTypes.has(type as StreamContentType)) {
		return true;
	}

	// Check type:subtype combination (e.g., 'system:init', 'system:status')
	if (subtype) {
		const typeSubtype = `${type}:${subtype}` as StreamContentType;
		if (config.contentTypes.has(typeSubtype)) {
			return true;
		}
	}

	return false;
}

function isHitlNoiseMessage(args: { message: NodeStreamMessage; hitlMessagePrefix: string }): boolean {
	const { message, hitlMessagePrefix } = args;

	if (message.type !== 'user') return false;
	const messageRecord = message as unknown as Record<string, unknown>;
	const result = messageRecord.tool_use_result;
	if (result === undefined || result === null) return false;
	const str = typeof result === 'string' ? result : JSON.stringify(result);
	return (
		str.includes(hitlMessagePrefix) ||
		str.includes('User rejected tool use')
	);
}

export function streamSdkMessageImpl(args: {
	config: Pick<StreamingConfig, 'contentTypes'>;
	message: NodeStreamMessage;
	emitJson: (payload: Exclude<StreamItemPayload, string>) => void;
	hitlMessagePrefix: string;
}): void {
	const { config, message, emitJson, hitlMessagePrefix } = args;

	if (!shouldStreamSdkMessage({ config, message })) {
		return;
	}
	if (isHitlNoiseMessage({ message, hitlMessagePrefix })) {
		return;
	}
	emitJson(message);
}
