import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { IBinaryData, IExecuteFunctions } from 'n8n-workflow';

import { maybeProcessBinaryInputs } from '../../operations/executeTask/binaryInputs';

function createBinaryInputContext(args: {
	fileName?: string;
	buffer?: Buffer;
	inputDirectory?: string;
	includeFileList?: boolean;
	bufferError?: Error;
	hasBinary?: boolean;
}): IExecuteFunctions {
	const buffer = args.buffer ?? Buffer.from('safe');
	const hasBinary = args.hasBinary ?? true;
	return {
		getNodeParameter: vi.fn((name: string, _itemIndex: number, fallbackValue: unknown) => {
			if (name === 'downloadBinaryInputs') return true;
			if (name === 'binaryInputDirectory') return args.inputDirectory ?? fallbackValue;
			if (name === 'includeFileList') return args.includeFileList ?? false;
			return fallbackValue;
		}),
		getInputData: vi.fn(() => [
			{
				json: {},
				...(hasBinary ? { binary: {
					upload: {
						fileName: args.fileName ?? 'notes.txt',
						mimeType: 'text/plain',
						fileSize: String(buffer.length),
					} as IBinaryData,
				} } : {}),
			},
		]),
		helpers: {
			getBinaryDataBuffer: vi.fn(async () => {
				if (args.bufferError) throw args.bufferError;
				return buffer;
			}),
		},
	} as unknown as IExecuteFunctions;
}

describe('maybeProcessBinaryInputs', () => {
	it('does not allow binary filenames to overwrite files outside the input directory', async () => {
		const root = mkdtempSync(join(tmpdir(), 'claude-agent-binary-inputs-'));
		const workdir = join(root, 'workdir');
		const target = join(workdir, 'package.json');
		mkdirSync(workdir, { recursive: true });
		writeFileSync(target, 'original');

		try {
			await expect(maybeProcessBinaryInputs({
				execFunctions: createBinaryInputContext({
					fileName: '../package.json',
					buffer: Buffer.from('pwned'),
				}),
				itemIndex: 0,
				taskDescription: 'read file',
				workingDirectory: workdir,
			})).rejects.toThrow(/Unsafe binary filename/);

			expect(readFileSync(target, 'utf8')).toBe('original');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('rejects binary input directories that traverse above the working directory', async () => {
		const root = mkdtempSync(join(tmpdir(), 'claude-agent-binary-inputs-'));
		const workdir = join(root, 'workdir');
		mkdirSync(workdir, { recursive: true });

		try {
			await expect(maybeProcessBinaryInputs({
				execFunctions: createBinaryInputContext({
					fileName: 'payload.txt',
					buffer: Buffer.from('pwned'),
					inputDirectory: '..',
				}),
				itemIndex: 0,
				taskDescription: 'read file',
				workingDirectory: workdir,
			})).rejects.toThrow(/escapes working directory/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('rejects absolute binary input directories', async () => {
		const root = mkdtempSync(join(tmpdir(), 'claude-agent-binary-inputs-'));
		const workdir = join(root, 'workdir');
		mkdirSync(workdir, { recursive: true });

		try {
			await expect(maybeProcessBinaryInputs({
				execFunctions: createBinaryInputContext({
					fileName: 'payload.txt',
					buffer: Buffer.from('pwned'),
					inputDirectory: join(root, 'outside'),
				}),
				itemIndex: 0,
				taskDescription: 'read file',
				workingDirectory: workdir,
			})).rejects.toThrow(/absolute paths are not allowed/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('downloads a binary to a nested safe input directory', async () => {
		const root = mkdtempSync(join(tmpdir(), 'claude-agent-binary-inputs-'));
		const workdir = join(root, 'workdir');

		try {
			await maybeProcessBinaryInputs({
				execFunctions: createBinaryInputContext({
					fileName: 'notes.txt',
					buffer: Buffer.from('safe'),
					inputDirectory: 'nested/uploads',
				}),
				itemIndex: 0,
				taskDescription: 'read file',
				workingDirectory: workdir,
			});

			expect(readFileSync(join(workdir, 'nested', 'uploads', 'notes.txt'), 'utf8')).toBe('safe');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('still downloads a binary with a safe filename', async () => {
		const root = mkdtempSync(join(tmpdir(), 'claude-agent-binary-inputs-'));
		const workdir = join(root, 'workdir');

		try {
			await maybeProcessBinaryInputs({
				execFunctions: createBinaryInputContext({
					fileName: 'notes.txt',
					buffer: Buffer.from('safe'),
				}),
				itemIndex: 0,
				taskDescription: 'read file',
				workingDirectory: workdir,
			});

			expect(readFileSync(join(workdir, '_inputs', 'notes.txt'), 'utf8')).toBe('safe');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails the item when binary buffer download fails', async () => {
		const root = mkdtempSync(join(tmpdir(), 'claude-agent-binary-inputs-'));
		const workdir = join(root, 'workdir');

		try {
			await expect(maybeProcessBinaryInputs({
				execFunctions: createBinaryInputContext({
					fileName: 'notes.txt',
					bufferError: new Error('buffer unavailable'),
				}),
				itemIndex: 0,
				taskDescription: 'read {upload}',
				workingDirectory: workdir,
			})).rejects.toThrow(/Failed to download binary "upload": buffer unavailable/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('fails when file-list placeholders cannot resolve to downloaded files', async () => {
		const root = mkdtempSync(join(tmpdir(), 'claude-agent-binary-inputs-'));
		const workdir = join(root, 'workdir');

		try {
			await expect(maybeProcessBinaryInputs({
				execFunctions: createBinaryInputContext({
					hasBinary: false,
				}),
				itemIndex: 0,
				taskDescription: 'read {files}',
				workingDirectory: workdir,
			})).rejects.toThrow(/Binary input placeholder\(s\) could not be resolved: \{files\}/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
