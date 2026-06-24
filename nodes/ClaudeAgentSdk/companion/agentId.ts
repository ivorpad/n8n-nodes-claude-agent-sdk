const COMPANION_AGENT_OPTION_VALUES = {
	missingCredential: '__agent_plane_missing_credential__',
	noAgents: '__agent_plane_no_agents__',
	loadFailed: '__agent_plane_load_failed__',
} as const;

const INVALID_AGENT_OPTION_VALUES = new Set<string>(Object.values(COMPANION_AGENT_OPTION_VALUES));

export { COMPANION_AGENT_OPTION_VALUES };

export function normalizeCompanionAgentId(value: unknown): string {
	const normalized = normalizeStringParameter(
		readResourceLocatorValue(value) ?? (typeof value === 'string' ? value : undefined),
	);
	return INVALID_AGENT_OPTION_VALUES.has(normalized) ? '' : normalized;
}

function normalizeStringParameter(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function readResourceLocatorValue(value: unknown): unknown {
	if (!value || typeof value !== 'object') return undefined;
	return (value as Record<string, unknown>).value;
}
