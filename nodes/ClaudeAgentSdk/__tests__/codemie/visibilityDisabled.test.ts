/**
 * Detection gate OFF (default in this repo: the companion package is not
 * installed, so isCodeMieAvailable() is false). The gated surface — the CodeMie
 * Proxy auth OPTION and the codeMieSsoApi CREDENTIAL — must be absent. (The
 * model/login property definitions live in the shared schema like the other
 * providers' fields; they are simply unreachable because their displayOptions
 * require the auth value that is hidden here.)
 */

import { describe, expect, it } from 'vitest';

import { claudeAgentSdkDescription } from '../../node/description';
import { authenticationProperty } from '../../nodeProperties/authentication';

describe('CodeMie visibility — companion not installed', () => {
	it('omits the CodeMie Proxy authentication option', () => {
		const values = (authenticationProperty.options ?? []).map(
			(option) => (option as { value?: string }).value,
		);
		expect(values).not.toContain('codeMieSsoApi');
	});

	it('omits the codeMieSsoApi credential', () => {
		const names = (claudeAgentSdkDescription.credentials ?? []).map((credential) => credential.name);
		expect(names).not.toContain('codeMieSsoApi');
	});
});
