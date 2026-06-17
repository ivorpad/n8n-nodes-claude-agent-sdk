import type { IBinaryData, IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import {
	collectGeneratedFileBinaries,
	parseGeneratedFilesConfig,
	type GeneratedFilesConfig,
} from '../../operations/executeTask/managedAgentBinaryOutputs';

type Helpers = IExecuteFunctions['helpers'];
type GetNodeParameter = IExecuteFunctions['getNodeParameter'];

function makePrepareBinaryDataMock() {
	return vi.fn(
		async (data: Buffer, fileName?: string, mimeType?: string): Promise<IBinaryData> => ({
			data: data.toString('base64'),
			mimeType: mimeType ?? 'application/octet-stream',
			fileName,
		}),
	);
}

function makeExec(prepare = makePrepareBinaryDataMock()): IExecuteFunctions {
	const helpersMock = { prepareBinaryData: prepare } as Partial<Helpers> as Helpers;
	const ctx: Partial<IExecuteFunctions> = { helpers: helpersMock };
	return ctx as IExecuteFunctions;
}

function makeExecWithParams(params: Record<string, unknown>): IExecuteFunctions {
	const getter = vi.fn((name: string, _idx: number, def: unknown) => {
		return Object.prototype.hasOwnProperty.call(params, name) ? params[name] : def;
	}) as Partial<GetNodeParameter> as GetNodeParameter;
	const ctx: Partial<IExecuteFunctions> = { getNodeParameter: getter };
	return ctx as IExecuteFunctions;
}

function fileArtifact(opts: {
	fileId?: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	base64?: string;
}) {
	return {
		type: 'artifact',
		session_id: 'sesn_abc',
		content: {
			type: 'file',
			fileId: opts.fileId ?? `file_${opts.filename}`,
			filename: opts.filename,
			mimeType: opts.mimeType,
			sizeBytes: opts.sizeBytes,
			base64: opts.base64 ?? Buffer.from('hello world').toString('base64'),
		},
	};
}

const baseConfig: GeneratedFilesConfig = {
	enabled: true,
	filenameGlobs: [],
	mimePrefixes: [],
	maxSizeBytes: 0,
	stripBase64FromArtifacts: true,
};

describe('collectGeneratedFileBinaries', () => {
	it('attaches every file when no filters are set', async () => {
		const artifacts = [
			fileArtifact({ filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 100 }),
			fileArtifact({ filename: 'summary.csv', mimeType: 'text/csv', sizeBytes: 200 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: baseConfig,
			execFunctions: makeExec(),
		});

		expect(result.attachments).toHaveLength(2);
		expect(result.attachments.map((a) => a.meta.filename)).toEqual(['report.pdf', 'summary.csv']);
		expect(result.warnings).toEqual([]);
	});

	it('filters by filename glob (case-insensitive, * wildcard)', async () => {
		const artifacts = [
			fileArtifact({ filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 1 }),
			fileArtifact({ filename: 'summary.csv', mimeType: 'text/csv', sizeBytes: 1 }),
			fileArtifact({ filename: 'output.PDF', mimeType: 'application/pdf', sizeBytes: 1 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: { ...baseConfig, filenameGlobs: ['*.pdf'] },
			execFunctions: makeExec(),
		});

		expect(result.attachments.map((a) => a.meta.filename)).toEqual(['report.pdf', 'output.PDF']);
	});

	it('filters by MIME prefix', async () => {
		const artifacts = [
			fileArtifact({ filename: 'a.png', mimeType: 'image/png', sizeBytes: 1 }),
			fileArtifact({ filename: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }),
			fileArtifact({ filename: 'c.csv', mimeType: 'text/csv', sizeBytes: 1 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: { ...baseConfig, mimePrefixes: ['image/'] },
			execFunctions: makeExec(),
		});

		expect(result.attachments.map((a) => a.meta.filename)).toEqual(['a.png', 'b.jpg']);
	});

	it('skips files exceeding max size and surfaces a warning', async () => {
		const artifacts = [
			fileArtifact({ filename: 'small.bin', mimeType: 'application/octet-stream', sizeBytes: 100 }),
			fileArtifact({ filename: 'huge.bin', mimeType: 'application/octet-stream', sizeBytes: 999_999 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: { ...baseConfig, maxSizeBytes: 500 },
			execFunctions: makeExec(),
		});

		expect(result.attachments.map((a) => a.meta.filename)).toEqual(['small.bin']);
		expect(result.warnings).toEqual([
			expect.stringContaining('huge.bin'),
		]);
	});

	it('treats max size at the boundary as accepted', async () => {
		const artifacts = [
			fileArtifact({ filename: 'edge.bin', mimeType: 'application/octet-stream', sizeBytes: 1024 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: { ...baseConfig, maxSizeBytes: 1024 },
			execFunctions: makeExec(),
		});

		expect(result.attachments).toHaveLength(1);
	});

	it('passes through non-file artifacts unchanged', async () => {
		const artifacts = [
			{ type: 'artifact', name: 'report', payload: { value: 'x' } },
			fileArtifact({ filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: baseConfig,
			execFunctions: makeExec(),
		});

		expect(result.attachments).toHaveLength(1);
		expect(result.artifactsForJson[0]).toBe(artifacts[0]);
	});

	it('strips base64 from the artifact JSON copy when configured', async () => {
		const artifacts = [
			fileArtifact({ filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: baseConfig,
			execFunctions: makeExec(),
		});

		const stripped = result.artifactsForJson[0] as {
			content: Record<string, unknown>;
		};
		expect(stripped.content.base64).toBeUndefined();
		expect(stripped.content.fileId).toBeDefined();
		expect(stripped.content.filename).toBe('r.pdf');
		expect((artifacts[0] as { content: { base64: string } }).content.base64).not.toBe('');
	});

	it('keeps base64 in the JSON copy when stripping is disabled', async () => {
		const artifacts = [
			fileArtifact({ filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: { ...baseConfig, stripBase64FromArtifacts: false },
			execFunctions: makeExec(),
		});

		expect(result.artifactsForJson).toBe(artifacts);
		expect((result.artifactsForJson[0] as { content: { base64: string } }).content.base64).not.toBe('');
	});

	it('round-trips bytes correctly via prepareBinaryData', async () => {
		const original = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x42]);
		const artifacts = [
			fileArtifact({
				filename: 'blob.bin',
				mimeType: 'application/octet-stream',
				sizeBytes: original.length,
				base64: original.toString('base64'),
			}),
		];

		const prepare = makePrepareBinaryDataMock();
		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: baseConfig,
			execFunctions: makeExec(prepare),
		});

		expect(prepare).toHaveBeenCalledTimes(1);
		const [bufferArg, filenameArg, mimeArg] = prepare.mock.calls[0];
		expect(bufferArg).toBeInstanceOf(Buffer);
		expect((bufferArg as Buffer).equals(original)).toBe(true);
		expect(filenameArg).toBe('blob.bin');
		expect(mimeArg).toBe('application/octet-stream');
		expect(result.attachments).toHaveLength(1);
	});

	it('warns and continues on prepareBinaryData failure', async () => {
		const artifacts = [
			fileArtifact({ filename: 'good.bin', mimeType: 'application/octet-stream', sizeBytes: 10 }),
			fileArtifact({ filename: 'bad.bin', mimeType: 'application/octet-stream', sizeBytes: 10 }),
		];

		let call = 0;
		const prepare = vi.fn(async (data: Buffer, fileName?: string, mimeType?: string) => {
			call++;
			if (call === 2) throw new Error('boom');
			return {
				data: data.toString('base64'),
				mimeType: mimeType ?? 'application/octet-stream',
				fileName,
			};
		});

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: baseConfig,
			execFunctions: makeExec(prepare),
		});

		expect(result.attachments.map((a) => a.meta.filename)).toEqual(['good.bin']);
		expect(result.warnings).toEqual([expect.stringContaining('bad.bin')]);
	});

	it('ignores artifacts with empty base64 payloads', async () => {
		const artifacts = [
			fileArtifact({ filename: 'empty.bin', mimeType: 'application/octet-stream', sizeBytes: 0, base64: '' }),
			fileArtifact({ filename: 'real.bin', mimeType: 'application/octet-stream', sizeBytes: 10 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: baseConfig,
			execFunctions: makeExec(),
		});

		expect(result.attachments.map((a) => a.meta.filename)).toEqual(['real.bin']);
	});

	it('combines filename glob and MIME prefix filters (AND semantics)', async () => {
		const artifacts = [
			fileArtifact({ filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 1 }),
			fileArtifact({ filename: 'report.csv', mimeType: 'text/csv', sizeBytes: 1 }),
			fileArtifact({ filename: 'photo.png', mimeType: 'image/png', sizeBytes: 1 }),
		];

		const result = await collectGeneratedFileBinaries({
			artifacts,
			config: { ...baseConfig, filenameGlobs: ['report.*'], mimePrefixes: ['application/'] },
			execFunctions: makeExec(),
		});

		expect(result.attachments.map((a) => a.meta.filename)).toEqual(['report.pdf']);
	});
});

describe('parseGeneratedFilesConfig', () => {
	it('returns disabled config when toggle is off', () => {
		const cfg = parseGeneratedFilesConfig(
			makeExecWithParams({ downloadGeneratedFiles: false }),
			0,
		);
		expect(cfg).toEqual({
			enabled: false,
			filenameGlobs: [],
			mimePrefixes: [],
			maxSizeBytes: 0,
			stripBase64FromArtifacts: true,
		});
	});

	it('parses comma-separated lists with whitespace', () => {
		const cfg = parseGeneratedFilesConfig(
			makeExecWithParams({
				downloadGeneratedFiles: true,
				generatedFilesFilter: '*.pdf,  report-*.csv ,',
				generatedFilesMimePrefix: 'image/, application/pdf',
				generatedFilesMaxSizeMb: 25,
				generatedFilesStripBase64: false,
			}),
			0,
		);
		expect(cfg.enabled).toBe(true);
		expect(cfg.filenameGlobs).toEqual(['*.pdf', 'report-*.csv']);
		expect(cfg.mimePrefixes).toEqual(['image/', 'application/pdf']);
		expect(cfg.maxSizeBytes).toBe(25 * 1024 * 1024);
		expect(cfg.stripBase64FromArtifacts).toBe(false);
	});

	it('treats max size of 0 as unlimited', () => {
		const cfg = parseGeneratedFilesConfig(
			makeExecWithParams({
				downloadGeneratedFiles: true,
				generatedFilesMaxSizeMb: 0,
			}),
			0,
		);
		expect(cfg.maxSizeBytes).toBe(0);
	});
});
