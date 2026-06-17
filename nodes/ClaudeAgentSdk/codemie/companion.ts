/**
 * Detection-gated bridge to the optional companion package
 * `n8n-nodes-claude-codemie`. Installing that package is the feature flag:
 * `isCodeMieAvailable()` (cached at module load) decides whether the CodeMie
 * Proxy authentication option, credential, and properties are exposed.
 *
 * The companion is NOT a dependency of this package — it is resolved at runtime
 * via `require`. We model only the slice of its public API we consume so the
 * main node never type-depends on it.
 */

import { createRequire } from 'node:module';

const COMPANION_PACKAGE = 'n8n-nodes-claude-codemie';

export interface CodeMieProxyHandle {
	url: string;
	gatewayKey: string;
}

export interface CodeMieModelOption {
	id: string;
	label: string;
}

export interface CodeMieCompanion {
	ensureCodemieProxy(options: { instanceUrl: string }): Promise<CodeMieProxyHandle>;
	fetchCodeMieModels(proxy: CodeMieProxyHandle): Promise<CodeMieModelOption[]>;
	buildLoginUrl(instanceUrl: string): string;
}

let availability: boolean | undefined;

/** Cached `require.resolve` of the companion — the CodeMie feature gate. */
export function isCodeMieAvailable(): boolean {
	if (availability === undefined) {
		try {
			createRequire(__filename).resolve(COMPANION_PACKAGE);
			availability = true;
		} catch {
			availability = false;
		}
	}
	return availability;
}

let cached: CodeMieCompanion | undefined;

/** Load the companion module, throwing a clear, actionable error if absent. */
export function loadCodeMieCompanion(): CodeMieCompanion {
	if (cached) {
		return cached;
	}
	try {
		cached = createRequire(__filename)(COMPANION_PACKAGE) as CodeMieCompanion;
		return cached;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(
			`CodeMie Proxy support requires the companion package "${COMPANION_PACKAGE}". ` +
				`Install it alongside this node and restart n8n. (${detail})`,
		);
	}
}
