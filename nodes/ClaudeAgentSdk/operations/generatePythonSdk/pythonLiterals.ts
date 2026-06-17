/**
 * Python literal rendering helpers for the generated SDK script.
 * Split out of generatePythonSdk/index.ts (file-size guard).
 */

/** Escape for Python double-quoted strings. */
export function esc(s: string | undefined | null): string {
	if (!s) return '';
	return s
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
}

/**
 * Escape a value for embedding inside a Python triple-quoted string literal
 * (`"""…"""`).
 *
 * SECURITY (V13): escaping only `"""` is insufficient. A value ending in a
 * backslash (`…\`) would escape the opening quote of the closing `"""`,
 * continuing or breaking the literal; a value ending in `"` would leave a
 * dangling quote after the delimiter. Both let crafted prompts inject code
 * into the generated script. We therefore escape backslashes FIRST (so a
 * trailing `\` becomes a literal `\\`), then escape every double-quote, which
 * makes it impossible for any run of quotes to close the literal early or to
 * dangle after it. Plain prompts (no backslashes/quotes) round-trip verbatim.
 */
export function escTriple(s: string | undefined | null): string {
	if (!s) return '';
	return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Python list literal. */
export function pyList(items: string[]): string {
	return `[${items.map((item) => `"${esc(item)}"`).join(', ')}]`;
}

/** Python dict literal (single-line). */
export function pyDict(obj: Record<string, unknown>): string {
	const entries = Object.entries(obj).map(([k, v]) => {
		if (typeof v === 'string') return `"${esc(k)}": "${esc(v)}"`;
		if (typeof v === 'number' || typeof v === 'boolean') return `"${esc(k)}": ${String(v)}`;
		if (v === null || v === undefined) return `"${esc(k)}": None`;
		return `"${esc(k)}": ${JSON.stringify(v)}`;
	});
	return `{${entries.join(', ')}}`;
}

/**
 * Python literal for arbitrary JSON-ish values with indentation.
 *
 * Renders real Python literals (True/False/None), not JSON (true/false/null):
 * raw JSON.stringify output is a NameError at Python import time — JSON Schema
 * output_format always contains `additionalProperties: false`.
 */
export function pyJsonLiteral(obj: unknown, indent: number): string {
	if (obj === null || obj === undefined) return 'None';
	if (typeof obj === 'boolean') return obj ? 'True' : 'False';
	if (typeof obj === 'number') return Number.isFinite(obj) ? String(obj) : 'None';
	if (typeof obj === 'string') return `"${esc(obj)}"`;

	const pad = ' '.repeat(indent);
	const childPad = ' '.repeat(indent + 4);

	if (Array.isArray(obj)) {
		if (obj.length === 0) return '[]';
		const items = obj.map((item) => `${childPad}${pyJsonLiteral(item, indent + 4)}`);
		return `[\n${items.join(',\n')},\n${pad}]`;
	}

	const entries = Object.entries(obj as Record<string, unknown>);
	if (entries.length === 0) return '{}';
	const lines = entries.map(
		([k, v]) => `${childPad}"${esc(k)}": ${pyJsonLiteral(v, indent + 4)}`,
	);
	return `{\n${lines.join(',\n')},\n${pad}}`;
}
