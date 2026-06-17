import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function handleCompanionItemError(
	execFunctions: IExecuteFunctions,
	error: unknown,
	itemIndex: number,
): INodeExecutionData {
	if (execFunctions.continueOnFail()) {
		return {
			json: {
				error: getErrorMessage(error),
			},
			pairedItem: { item: itemIndex },
		};
	}

	throw new NodeOperationError(
		execFunctions.getNode(),
		error instanceof Error ? error : getErrorMessage(error),
		{ itemIndex },
	);
}
