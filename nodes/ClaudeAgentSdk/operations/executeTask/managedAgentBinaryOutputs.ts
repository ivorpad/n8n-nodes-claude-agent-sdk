/**
 * Convert managed-agent generated-file artifacts into n8n binary attachments.
 *
 * The managed-agent adapter already downloads session-scoped files after
 * `session.status_idle` and emits them as artifact messages of the shape:
 *
 *   {
 *     type: 'artifact',
 *     session_id: '...',
 *     content: { type: 'file', fileId, filename, mimeType, sizeBytes, base64 },
 *   }
 *
 * Those messages are collected verbatim into `processed.artifacts` by
 * `processMessages` (see operations/executeTask/messages.ts). This module
 * walks that array, applies user-configured filters (filename glob, MIME
 * prefix, max size), and turns each accepted file into an `IBinaryData`
 * via `helpers.prepareBinaryData`. Optionally strips the base64 from the
 * JSON copy so the bytes don't appear twice in the workflow data.
 *
 * No SDK calls — the data is already in memory; this is pure transform.
 */

import type { IBinaryData, IExecuteFunctions } from 'n8n-workflow';

interface GeneratedFileMeta {
	fileId: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
}

export interface GeneratedFileAttachment {
	meta: GeneratedFileMeta;
	binary: IBinaryData;
}

export interface GeneratedFilesConfig {
	enabled: boolean;
	filenameGlobs: string[];
	mimePrefixes: string[];
	maxSizeBytes: number;
	stripBase64FromArtifacts: boolean;
}

interface ArtifactFileContent {
	type: 'file';
	fileId: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	base64: string;
}

interface ArtifactMessage {
	type: 'artifact';
	content: ArtifactFileContent | { type?: string; [key: string]: unknown };
	[key: string]: unknown;
}

function parseCommaList(value: unknown): string[] {
	if (typeof value !== 'string') return [];
	return value
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function parseGeneratedFilesConfig(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
): GeneratedFilesConfig {
	const enabled = asBoolean(
		execFunctions.getNodeParameter('downloadGeneratedFiles', itemIndex, false),
		false,
	);

	if (!enabled) {
		return {
			enabled: false,
			filenameGlobs: [],
			mimePrefixes: [],
			maxSizeBytes: 0,
			stripBase64FromArtifacts: true,
		};
	}

	const filenameGlobs = parseCommaList(
		execFunctions.getNodeParameter('generatedFilesFilter', itemIndex, ''),
	);
	const mimePrefixes = parseCommaList(
		execFunctions.getNodeParameter('generatedFilesMimePrefix', itemIndex, ''),
	);
	const maxSizeMb = asFiniteNumber(
		execFunctions.getNodeParameter('generatedFilesMaxSizeMb', itemIndex, 50),
		50,
	);
	const maxSizeBytes = maxSizeMb > 0 ? Math.floor(maxSizeMb * 1024 * 1024) : 0;
	const stripBase64FromArtifacts = asBoolean(
		execFunctions.getNodeParameter('generatedFilesStripBase64', itemIndex, true),
		true,
	);

	return {
		enabled: true,
		filenameGlobs,
		mimePrefixes,
		maxSizeBytes,
		stripBase64FromArtifacts,
	};
}

/**
 * Translate a filename glob (`*` and `?`) to a regex.
 * Filename only — no path semantics.
 */
function globToRegex(glob: string): RegExp {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
	return new RegExp(`^${pattern}$`, 'i');
}

function matchesFilename(filename: string, globs: string[]): boolean {
	if (globs.length === 0) return true;
	return globs.some((g) => globToRegex(g).test(filename));
}

function matchesMime(mime: string, prefixes: string[]): boolean {
	if (prefixes.length === 0) return true;
	return prefixes.some((p) => mime.startsWith(p));
}

function isFileArtifact(value: unknown): value is ArtifactMessage & {
	content: ArtifactFileContent;
} {
	if (!value || typeof value !== 'object') return false;
	const msg = value as Record<string, unknown>;
	if (msg.type !== 'artifact') return false;
	const content = msg.content as Record<string, unknown> | undefined;
	if (!content || content.type !== 'file') return false;
	return (
		typeof content.fileId === 'string'
		&& typeof content.filename === 'string'
		&& typeof content.mimeType === 'string'
		&& typeof content.sizeBytes === 'number'
		&& typeof content.base64 === 'string'
		&& content.base64.length > 0
	);
}

/**
 * Walk processed.artifacts; for each artifact whose `content.type === 'file'`:
 *   - apply filters; on skip, leave the entry as-is (visibility preserved)
 *   - on accept, decode base64 → Buffer → helpers.prepareBinaryData
 *   - if config.stripBase64FromArtifacts, replace the JSON copy of the
 *     artifact with one whose content drops `.base64`
 *
 * Per-file errors are caught and surfaced as warnings; this helper never
 * throws out — a failure here must not mask the agent run result.
 */
export async function collectGeneratedFileBinaries(args: {
	artifacts: unknown[];
	config: GeneratedFilesConfig;
	execFunctions: IExecuteFunctions;
}): Promise<{
	attachments: GeneratedFileAttachment[];
	artifactsForJson: unknown[];
	warnings: string[];
}> {
	const { artifacts, config, execFunctions } = args;
	const attachments: GeneratedFileAttachment[] = [];
	const warnings: string[] = [];
	const artifactsForJson: unknown[] = artifacts.slice();
	let mutated = false;

	for (let i = 0; i < artifacts.length; i++) {
		const entry = artifacts[i];
		if (!isFileArtifact(entry)) continue;

		const file = entry.content;

		if (!matchesFilename(file.filename, config.filenameGlobs)) continue;
		if (!matchesMime(file.mimeType, config.mimePrefixes)) continue;
		if (config.maxSizeBytes > 0 && file.sizeBytes > config.maxSizeBytes) {
			warnings.push(
				`Skipped "${file.filename}" (${file.sizeBytes} bytes) — exceeds Max File Size`,
			);
			continue;
		}

		try {
			const buffer = Buffer.from(file.base64, 'base64');
			const binary = await execFunctions.helpers.prepareBinaryData(
				buffer,
				file.filename,
				file.mimeType,
			);

			attachments.push({
				meta: {
					fileId: file.fileId,
					filename: file.filename,
					mimeType: file.mimeType,
					sizeBytes: file.sizeBytes,
				},
				binary,
			});

			if (config.stripBase64FromArtifacts) {
				const contentWithoutBase64: Omit<ArtifactFileContent, 'base64'> = {
					type: file.type,
					fileId: file.fileId,
					filename: file.filename,
					mimeType: file.mimeType,
					sizeBytes: file.sizeBytes,
				};
				artifactsForJson[i] = {
					...entry,
					content: contentWithoutBase64,
				};
				mutated = true;
			}
		} catch (err: unknown) {
			const detail = err instanceof Error ? err.message : String(err);
			warnings.push(`Failed to attach "${file.filename}": ${detail}`);
		}
	}

	return {
		attachments,
		artifactsForJson: mutated ? artifactsForJson : artifacts,
		warnings,
	};
}
