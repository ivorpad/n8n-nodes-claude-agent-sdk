import { describe, it, expect } from 'vitest';

import { managedAgentBinaryOutputsProperties } from '../../nodeProperties/managedAgentBinaryOutputs';
import { nodeProperties } from '../../nodeProperties';

const PROPERTY_NAMES = [
	'downloadGeneratedFiles',
	'generatedFilesFilter',
	'generatedFilesMimePrefix',
	'generatedFilesMaxSizeMb',
	'generatedFilesStripBase64',
] as const;

describe('managedAgentBinaryOutputsProperties', () => {
	it('exports the toggle and all four child properties', () => {
		const names = managedAgentBinaryOutputsProperties.map((p) => p.name);
		expect(names).toEqual([...PROPERTY_NAMES]);
	});

	it('every property is gated to backendMode === managedAgent', () => {
		for (const property of managedAgentBinaryOutputsProperties) {
			expect(property.displayOptions?.show?.backendMode).toEqual(['managedAgent']);
		}
	});

	it('child properties additionally require downloadGeneratedFiles=true', () => {
		const childNames = PROPERTY_NAMES.filter((n) => n !== 'downloadGeneratedFiles');
		for (const property of managedAgentBinaryOutputsProperties) {
			if (!childNames.includes(property.name as typeof childNames[number])) continue;
			expect(property.displayOptions?.show?.downloadGeneratedFiles).toEqual([true]);
		}
	});

	it('the toggle does NOT depend on its own value', () => {
		const toggle = managedAgentBinaryOutputsProperties.find(
			(p) => p.name === 'downloadGeneratedFiles',
		);
		expect(toggle).toBeDefined();
		expect(toggle?.displayOptions?.show?.downloadGeneratedFiles).toBeUndefined();
	});

	it('all properties are registered in the top-level nodeProperties array', () => {
		const registered = nodeProperties.map((p) => p.name);
		for (const name of PROPERTY_NAMES) {
			expect(registered).toContain(name);
		}
	});

	it('the toggle defaults to false (opt-in)', () => {
		const toggle = managedAgentBinaryOutputsProperties.find(
			(p) => p.name === 'downloadGeneratedFiles',
		);
		expect(toggle?.default).toBe(false);
	});
});
