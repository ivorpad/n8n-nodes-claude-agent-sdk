import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { assertStrictHitlRequestEnvelope } from '../../ClaudeAgentSdk/hitl/contract';
import { requestSignatureValidationIfAvailable } from '../../ClaudeAgentChannelShared/core/compat';
import {
	addSignedQueryParam,
	buildPendingRecordFromRequest,
	buildResumeUrl,
	computeCompanionTimeoutMs,
	computeCompanionWaitTill,
} from '../../ClaudeAgentChannelShared/core/executeRuntime';
import { handleCompanionItemError } from '../../ClaudeAgentChannelShared/core/itemError';
import { savePending } from '../store/PendingTelegramHitlStore';
import { sendApprovalMessage, sendQuestionMessage } from '../transport/telegram';
import type {
	OutboundMessageMode,
	PendingStoreBackend,
	PendingTelegramHitlRecord,
	ReplyHandlingMode,
} from '../types';

export async function execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const outputItems = [...items];
	let hasDispatchOutput = false;

	for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
		const itemType = (items[itemIndex]?.json as Record<string, unknown> | undefined)?.type;
		if (itemType !== 'approval_request' && itemType !== 'question_request') continue;

		try {
			requestSignatureValidationIfAvailable(this);

			const request = assertStrictHitlRequestEnvelope(items[itemIndex].json);
			const chatId = this.getNodeParameter('chatId', itemIndex) as string;
			const messagePrefix = this.getNodeParameter('messagePrefix', itemIndex, '') as string;
			const messageTitle = this.getNodeParameter('messageTitle', itemIndex, '') as string;
			const outboundMessageMode = this.getNodeParameter(
				'outboundMessageMode',
				itemIndex,
				'asIs',
			) as OutboundMessageMode;
			const replyHandlingMode = this.getNodeParameter(
				'replyHandlingMode',
				itemIndex,
				'dispatchAndExit',
			) as ReplyHandlingMode;
			const maxOutboundCharacters = Number(
				this.getNodeParameter('maxOutboundCharacters', itemIndex, 400),
			);
			const fallbackMessage = this.getNodeParameter('fallbackMessage', itemIndex, '') as string;
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
			const baseRecord: PendingTelegramHitlRecord = {
				...buildPendingRecordFromRequest(request, timeoutMs),
				channel: 'telegram',
				recipientId: chatId.trim(),
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
					chatId,
					messagePrefix,
					title: messageTitle,
					outboundMessageMode,
					maxOutboundCharacters,
					fallbackMessage,
					request,
					approveUrl,
					denyUrl,
				});
				if (sendResult.providerMessageId) {
					providerMessageId = sendResult.providerMessageId;
					await savePending(this, {
						...baseRecord,
						providerMessageId,
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
					chatId,
					messagePrefix,
					title: messageTitle,
					outboundMessageMode,
					maxOutboundCharacters,
					fallbackMessage,
					request,
					responseUrl,
				});
				if (sendResult.providerMessageId) {
					providerMessageId = sendResult.providerMessageId;
					await savePending(this, {
						...baseRecord,
						providerMessageId,
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
