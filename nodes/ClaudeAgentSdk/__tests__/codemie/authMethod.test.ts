import { describe, expect, it } from 'vitest';

import {
	AUTH_METHOD_VALUES,
	NODE_CREDENTIAL_TYPE_VALUES,
	isNodeCredentialType,
	resolveAuthMethod,
} from '../../authMethod';

describe('authMethod — CodeMie', () => {
	it('registers the codemie auth method and codeMieSsoApi credential type', () => {
		expect(AUTH_METHOD_VALUES).toContain('codemie');
		expect(NODE_CREDENTIAL_TYPE_VALUES).toContain('codeMieSsoApi');
		expect(isNodeCredentialType('codeMieSsoApi')).toBe(true);
	});

	it('resolves the credential-type dropdown value to codemie', () => {
		expect(resolveAuthMethod('codeMieSsoApi', 'claudeApi')).toBe('codemie');
	});

	it('resolves the legacy authentication-only value to codemie', () => {
		expect(resolveAuthMethod('codemie', 'claudeApi')).toBe('codemie');
	});

	it('resolves the legacy predefinedCredentialType selector to codemie', () => {
		expect(resolveAuthMethod('predefinedCredentialType', 'codeMieSsoApi')).toBe('codemie');
	});
});
