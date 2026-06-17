/**
 * Detection gate ON: when the companion package resolves, the CodeMie Proxy
 * auth option, credential, and properties are present in the node description.
 * (companion module mocked to isCodeMieAvailable() === true, evaluated at the
 * module load of description.ts / authentication.ts.)
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../codemie/companion', () => ({
	isCodeMieAvailable: () => true,
	loadCodeMieCompanion: vi.fn(),
}));

import { claudeAgentSdkDescription } from '../../node/description';
import { authenticationProperty } from '../../nodeProperties/authentication';

describe('CodeMie visibility — companion installed', () => {
	it('adds the CodeMie Proxy authentication option', () => {
		const values = (authenticationProperty.options ?? []).map(
			(option) => (option as { value?: string }).value,
		);
		expect(values).toContain('codeMieSsoApi');
	});

	it('declares the codeMieSsoApi provider credential', () => {
		const names = (claudeAgentSdkDescription.credentials ?? []).map((credential) => credential.name);
		expect(names).toContain('codeMieSsoApi');
	});

	it('includes the CodeMie model properties', () => {
		const names = claudeAgentSdkDescription.properties.map((property) => property.name);
		expect(names).toContain('codeMieModel');
		expect(names).toContain('codeMieModelManual');
	});
});
