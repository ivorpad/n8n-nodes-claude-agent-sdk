import type { IExecuteFunctions } from 'n8n-workflow';

/**
 * n8n-workflow < 2.14 exposed setSignatureValidationRequired() and HITL
 * dispatch had to call it before issuing signed resume URLs; n8n-workflow
 * 2.14.0 removed the method (signature validation became implicit). Call it
 * only when present so companion dispatch works on both runtime generations
 * instead of throwing TypeError on >= 2.14.
 */
export function requestSignatureValidationIfAvailable(execFunctions: IExecuteFunctions): void {
	const candidate = execFunctions as IExecuteFunctions & {
		setSignatureValidationRequired?: () => void;
	};
	candidate.setSignatureValidationRequired?.();
}
