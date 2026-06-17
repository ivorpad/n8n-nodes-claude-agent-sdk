import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { assertStrictHitlRequestEnvelope } from '../../ClaudeAgentSdk/hitl/contract';
import { requestSignatureValidationIfAvailable } from '../../ClaudeAgentChannelShared/core/compat';
import {
	addSignedQueryParam,
	buildPendingRecordFromRequest,
	buildResumeUrl,
	computeCompanionTimeoutMs,
	computeCompanionWaitTill,
	normalizeCompanionPayload,
} from '../runtime/executeRuntime';
import { handleCompanionItemError } from '../../ClaudeAgentChannelShared/core/itemError';
import { savePending } from '../store/PendingWhatsAppHitlStore';
import {
	buildCompanionBody,
	sanitizePhoneNumber,
	sendApprovalMessage,
	sendMessage as sendWhatsAppMessage,
	sendQuestionMessage,
} from '../transport/whatsapp';
import type {
	OutboundMessageMode,
	PendingStoreBackend,
	PendingWhatsAppHitlRecord,
	ReplyHandlingMode,
	WhatsAppCompanionFailureBehavior,
	WhatsAppCompanionMessageType,
	WhatsAppHitlDeliveryMode,
} from '../types';
import { handleTriggerInbound, normalizeRecipientId } from './triggerInbound';


export async function execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const resource = this.getNodeParameter('resource', 0, 'hitl') as string;

	if (resource === 'sendMessage') {
		const results: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const messageType = this.getNodeParameter('sendMessageType', itemIndex, 'text') as string;
				const recipientPhoneNumber = this.getNodeParameter('recipientPhoneNumber', itemIndex) as string;
				const senderPhoneNumberId = (
					this.getNodeParameter('senderPhoneNumberId', itemIndex, '') as string
				).trim() || undefined;

				let result;
				if (messageType === 'text') {
					const text = this.getNodeParameter('sendMessageText', itemIndex, '') as string;
					const previewUrl = this.getNodeParameter('sendPreviewUrl', itemIndex, true) as boolean;
					const body: IDataObject = {
						messaging_product: 'whatsapp',
						to: sanitizePhoneNumber(recipientPhoneNumber),
						type: 'text',
						text: { preview_url: previewUrl, body: text },
					};
					result = await sendWhatsAppMessage(this, body, senderPhoneNumberId);
				} else {
					const payload = normalizeCompanionPayload(
						this.getNodeParameter('sendMessagePayload', itemIndex, {}),
					);
					const body = buildCompanionBody({
						recipientPhoneNumber,
						companionMessageType: messageType,
						companionPayload: payload,
						defaultMessage: '',
					});
					if (!body) {
						throw new NodeOperationError(
							this.getNode(),
							`Unsupported message type: ${messageType}`,
							{ itemIndex },
						);
					}
					result = await sendWhatsAppMessage(this, body, senderPhoneNumberId);
				}

				results.push({
					json: {
						success: true,
						providerMessageId: result.providerMessageId,
					},
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				results.push(handleCompanionItemError(this, error, itemIndex));
			}
		}
		return [results];
	}
	const triggerHandling = await handleTriggerInbound(
		this,
		(items[0]?.json as Record<string, unknown> | undefined) ?? {},
		0,
	);
	if (triggerHandling) {
		if (triggerHandling.mode === 'passthrough') return [items];
		if (triggerHandling.mode === 'drop') return [[]];
		return [[{ json: triggerHandling.envelope as unknown as IDataObject }]];
	}
	const outputItems = [...items];
	let hasDispatchOutput = false;

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		const itemType = (items[itemIndex]?.json as Record<string, unknown> | undefined)?.type;
		if (itemType !== 'approval_request' && itemType !== 'question_request') continue;

		try {
			requestSignatureValidationIfAvailable(this);

			const request = assertStrictHitlRequestEnvelope(items[itemIndex].json);
			const recipientPhoneNumber = this.getNodeParameter('recipientPhoneNumber', itemIndex) as string;
			const deliveryMode = this.getNodeParameter('deliveryMode', itemIndex, 'textLinks') as WhatsAppHitlDeliveryMode;
			const messagePrefix = this.getNodeParameter('messagePrefix', itemIndex, '') as string;
			const messageTitle = this.getNodeParameter('messageTitle', itemIndex, '') as string;
			const outboundMessageMode = this.getNodeParameter(
				'outboundMessageMode',
				itemIndex,
				'asIs',
			) as OutboundMessageMode;
			const maxOutboundCharacters = Number(
				this.getNodeParameter('maxOutboundCharacters', itemIndex, 240),
			);
			const fallbackMessage = this.getNodeParameter('fallbackMessage', itemIndex, '') as string;
			const templateName = this.getNodeParameter('templateName', itemIndex, '') as string;
			const templateLanguageCode = this.getNodeParameter('templateLanguageCode', itemIndex, 'en_US') as string;
			const replyHandlingMode = this.getNodeParameter(
				'replyHandlingMode',
				itemIndex,
				'dispatchAndExit',
			) as ReplyHandlingMode;
			const enableCompanionMessage = Boolean(
				this.getNodeParameter('enableCompanionMessage', itemIndex, false),
			);
			const companionMessageType = this.getNodeParameter(
				'companionMessageType',
				itemIndex,
				'text',
			) as WhatsAppCompanionMessageType;
			const companionPayload = enableCompanionMessage
				? normalizeCompanionPayload(this.getNodeParameter('companionPayload', itemIndex, {}))
				: undefined;
			const companionFailureBehavior = this.getNodeParameter(
				'companionFailureBehavior',
				itemIndex,
				'continue',
			) as WhatsAppCompanionFailureBehavior;
			const pendingStoreBackend = this.getNodeParameter(
				'pendingStoreBackend',
				itemIndex,
				'staticData',
			) as PendingStoreBackend;
			const pendingStoreTableName = this.getNodeParameter(
				'pendingStoreTableName',
				itemIndex,
				'claude_hitl_pending',
			) as string;
			const storeConfig = {
				backend: pendingStoreBackend,
				tableName: pendingStoreTableName,
			} as const;

			const timeoutMs = replyHandlingMode === 'waitForReply'
				? computeCompanionTimeoutMs(this, itemIndex)
				: 0;
			if (!request.sessionId || request.sessionId.trim().length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'HITL request is missing sessionId. Configure Claude Agent SDK session memory so approvals/questions can resume reliably.',
				);
			}

			const baseRecord: PendingWhatsAppHitlRecord = {
				...buildPendingRecordFromRequest(request, timeoutMs),
				channel: 'whatsapp',
				recipientId: normalizeRecipientId(recipientPhoneNumber),
			};
			await savePending(this, baseRecord, storeConfig);
			let providerMessageId: string | undefined;

			if (replyHandlingMode === 'waitForReply') {
				const waitTill = computeCompanionWaitTill(timeoutMs);
				await this.putExecutionToWait(waitTill);
			}

			if (request.type === 'approval_request') {
				const approveParams: Record<string, string> = {
					requestId: request.requestId,
					approved: 'true',
				};
				const denyParams: Record<string, string> = {
					requestId: request.requestId,
					approved: 'false',
				};
				addSignedQueryParam(approveParams, 'sid', request.sessionId);
				addSignedQueryParam(denyParams, 'sid', request.sessionId);
				addSignedQueryParam(approveParams, 'afps', request.approvedFingerprints);
				addSignedQueryParam(denyParams, 'afps', request.approvedFingerprints);
				addSignedQueryParam(approveParams, 'fp', request.fingerprint);
				addSignedQueryParam(denyParams, 'fp', request.fingerprint);

				const approveUrl = buildResumeUrl(this, replyHandlingMode, approveParams);
				const denyUrl = buildResumeUrl(this, replyHandlingMode, denyParams);

				const sendResult = await sendApprovalMessage(this, {
					recipientPhoneNumber,
					deliveryMode,
					messagePrefix,
					title: messageTitle,
					outboundMessageMode,
					maxOutboundCharacters,
					fallbackMessage,
					templateName,
					templateLanguageCode,
					companionMessageType: enableCompanionMessage ? companionMessageType : undefined,
					companionPayload,
					companionFailureBehavior,
					request,
					approveUrl,
					denyUrl,
				});
				if (sendResult.providerMessageId) {
					providerMessageId = sendResult.providerMessageId;
					await savePending(this, {
						...baseRecord,
						providerMessageId: sendResult.providerMessageId,
					}, storeConfig);
				}
			} else {
				const responseParams: Record<string, string> = {
					requestId: request.requestId,
					type: 'question',
				};
				addSignedQueryParam(responseParams, 'sid', request.sessionId);
				addSignedQueryParam(responseParams, 'afps', request.approvedFingerprints);
				if (Array.isArray(request.questions) && request.questions.length > 0) {
					responseParams.q = Buffer.from(JSON.stringify(request.questions)).toString('base64');
				}
				const responseUrl = buildResumeUrl(this, replyHandlingMode, responseParams);

				const sendResult = await sendQuestionMessage(this, {
					recipientPhoneNumber,
					deliveryMode,
					messagePrefix,
					title: messageTitle,
					outboundMessageMode,
					maxOutboundCharacters,
					fallbackMessage,
					templateName,
					templateLanguageCode,
					companionMessageType: enableCompanionMessage ? companionMessageType : undefined,
					companionPayload,
					companionFailureBehavior,
					request,
					responseUrl,
				});
				if (sendResult.providerMessageId) {
					providerMessageId = sendResult.providerMessageId;
					await savePending(this, {
						...baseRecord,
						providerMessageId: sendResult.providerMessageId,
					}, storeConfig);
				}
			}

			if (replyHandlingMode !== 'waitForReply') {
				outputItems[itemIndex] = {
					json: {
						...(items[itemIndex]?.json as IDataObject),
						dispatchStatus: 'dispatched',
						replyHandlingMode,
						pendingStoreBackend,
						pendingStoreTableName,
						providerMessageId,
					},
					pairedItem: { item: itemIndex },
				};
				hasDispatchOutput = true;
			}
		} catch (error) {
			outputItems[itemIndex] = handleCompanionItemError(this, error, itemIndex);
		}
	}

	if (hasDispatchOutput) {
		return [
			outputItems.filter((_item, itemIndex) => {
				const itemType = (items[itemIndex]?.json as Record<string, unknown> | undefined)?.type;
				return itemType === 'approval_request' || itemType === 'question_request';
			}),
		];
	}

	return [outputItems];
}
