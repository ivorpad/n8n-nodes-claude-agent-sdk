/**
 * Binary Inputs Handler
 *
 * Downloads binary data from input items to the working directory
 * and provides placeholder replacement for referencing files in task descriptions.
 */

import { basename, isAbsolute, relative, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import type { IExecuteFunctions, IBinaryKeyData } from 'n8n-workflow';

interface BinaryInputsConfig {
	enabled?: boolean;
	inputDirectory?: string;
	includeFileList?: boolean;
}

interface DownloadedFile {
	propertyName: string;
	fileName: string;
	filePath: string;
	relativePath: string;
	mimeType: string;
	size?: number;
}

interface ResolvedBinaryInputDirectory {
	inputDirectory: string;
	targetDir: string;
}

function isPathInside(childPath: string, parentPath: string): boolean {
	const relativePath = relative(parentPath, childPath);
	return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function resolveSafeBinaryFilePath(targetDir: string, rawFileName: string): {
	fileName: string;
	filePath: string;
} {
	const fileName = rawFileName.trim();
	if (!fileName || fileName === '.' || fileName === '..') {
		throw new Error('Binary filename must be a non-empty basename');
	}
	if (
		isAbsolute(fileName)
		|| fileName !== basename(fileName)
		|| fileName.includes('/')
		|| fileName.includes('\\')
	) {
		throw new Error(`Unsafe binary filename: ${fileName}`);
	}

	const resolvedTargetDir = resolve(targetDir);
	const filePath = resolve(resolvedTargetDir, fileName);
	if (!isPathInside(filePath, resolvedTargetDir)) {
		throw new Error(`Binary file path escapes input directory: ${fileName}`);
	}

	return { fileName, filePath };
}

function normalizeRelativePathSegment(value: string): string {
	return value.replace(/\\/g, '/');
}

function resolveSafeBinaryInputDirectory(
	workingDirectory: string,
	rawInputDirectory: string | undefined,
): ResolvedBinaryInputDirectory {
	const inputDirectory = (rawInputDirectory?.trim() || '_inputs');
	if (isAbsolute(inputDirectory)) {
		throw new Error(`Unsafe binary input directory: absolute paths are not allowed (${inputDirectory})`);
	}

	const resolvedWorkingDirectory = resolve(workingDirectory);
	const targetDir = resolve(resolvedWorkingDirectory, inputDirectory);
	if (!isPathInside(targetDir, resolvedWorkingDirectory)) {
		throw new Error(`Unsafe binary input directory: ${inputDirectory} escapes working directory`);
	}

	const relativeInputDirectory = normalizeRelativePathSegment(
		relative(resolvedWorkingDirectory, targetDir),
	);
	return {
		inputDirectory: relativeInputDirectory || '.',
		targetDir,
	};
}

function getBinaryPropertyNames(execFunctions: IExecuteFunctions, itemIndex: number): string[] {
	const item = execFunctions.getInputData()[itemIndex];
	if (!item?.binary) return [];
	return Object.entries(item.binary as IBinaryKeyData)
		.filter(([, binaryMeta]) => Boolean(binaryMeta))
		.map(([propertyName]) => propertyName);
}

function assertNoUnresolvedBinaryPlaceholders(args: {
	taskDescription: string;
	downloadedFiles: DownloadedFile[];
	binaryPropertyNames: string[];
}): void {
	const supportedGlobalPlaceholders = ['files', 'files:paths', 'files:names'];
	const downloadedProperties = new Set(args.downloadedFiles.map((file) => file.propertyName));
	const unresolved: string[] = [];

	for (const placeholder of supportedGlobalPlaceholders) {
		if (args.taskDescription.includes(`{${placeholder}}`) && args.downloadedFiles.length === 0) {
			unresolved.push(placeholder);
		}
	}

	for (const propertyName of args.binaryPropertyNames) {
		if (args.taskDescription.includes(`{${propertyName}}`) && !downloadedProperties.has(propertyName)) {
			unresolved.push(propertyName);
		}
	}

	if (unresolved.length > 0) {
		throw new Error(
			`Binary input placeholder(s) could not be resolved: ${unresolved.map((name) => `{${name}}`).join(', ')}`,
		);
	}
}

export async function maybeProcessBinaryInputs(args: {
	execFunctions: IExecuteFunctions;
	itemIndex: number;
	taskDescription: string;
	workingDirectory: string;
}): Promise<string> {
	const { execFunctions, itemIndex, workingDirectory } = args;
	const taskDescription = args.taskDescription ?? '';

	const downloadBinaryInputsEnabled = execFunctions.getNodeParameter('downloadBinaryInputs', itemIndex, false) as boolean;

	if (!downloadBinaryInputsEnabled || !workingDirectory) {
		return taskDescription;
	}

	const binaryInputsConfig: BinaryInputsConfig = {
		enabled: true,
		inputDirectory: execFunctions.getNodeParameter('binaryInputDirectory', itemIndex, '_inputs') as string,
		includeFileList: execFunctions.getNodeParameter('includeFileList', itemIndex, true) as boolean,
	};

	const downloadedFiles = await downloadBinaryInputs(
		execFunctions,
		itemIndex,
		workingDirectory,
		binaryInputsConfig,
	);

	assertNoUnresolvedBinaryPlaceholders({
		taskDescription,
		downloadedFiles,
		binaryPropertyNames: getBinaryPropertyNames(execFunctions, itemIndex),
	});

	if (downloadedFiles.length === 0) {
		return taskDescription;
	}

	let updated = replaceBinaryPlaceholders(taskDescription, downloadedFiles);

	// Optionally append file list to task description
	if (binaryInputsConfig.includeFileList !== false) {
		const inputDirectory = binaryInputsConfig.inputDirectory || '_inputs';
		updated += buildFileListContext(downloadedFiles, inputDirectory);
	}

	return updated;
}

/**
 * Download all binary inputs to the working directory
 */
async function downloadBinaryInputs(
	execFunctions: IExecuteFunctions,
	itemIndex: number,
	workingDirectory: string,
	config: BinaryInputsConfig,
): Promise<DownloadedFile[]> {
	if (!config.enabled) {
		return [];
	}

	const items = execFunctions.getInputData();
	const item = items[itemIndex];

	if (!item.binary || Object.keys(item.binary).length === 0) {
		return [];
	}

	const downloadedFiles: DownloadedFile[] = [];
	const { inputDirectory, targetDir } = resolveSafeBinaryInputDirectory(
		workingDirectory,
		config.inputDirectory,
	);

	// Create target directory
	await mkdir(targetDir, { recursive: true });

	// Download each binary property
	for (const [propName, binaryMeta] of Object.entries(item.binary as IBinaryKeyData)) {
		if (!binaryMeta) continue;

		try {
			const { fileName, filePath } = resolveSafeBinaryFilePath(
				targetDir,
				binaryMeta.fileName || `${propName}.bin`,
			);
			const relativePath = inputDirectory === '.'
				? fileName
				: `${inputDirectory}/${fileName}`;

			// Get binary buffer
			const buffer = await execFunctions.helpers.getBinaryDataBuffer(itemIndex, propName);

			// Write to file
			await writeFile(filePath, buffer);

			downloadedFiles.push({
				propertyName: propName,
				fileName,
				filePath,
				relativePath,
				mimeType: binaryMeta.mimeType || 'application/octet-stream',
				size: binaryMeta.fileSize ? parseInt(binaryMeta.fileSize, 10) : buffer.length,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to download binary "${propName}": ${message}`);
		}
	}

	return downloadedFiles;
}

/**
 * Replace placeholders in task description with actual file paths
 *
 * Supported placeholders:
 * - {propertyName} - replaced with specific file path (e.g., {attachment_0})
 * - {files} - replaced with bullet list of all file paths
 * - {files:paths} - replaced with comma-separated paths
 * - {files:names} - replaced with comma-separated filenames
 */
function replaceBinaryPlaceholders(
	taskDescription: string,
	downloadedFiles: DownloadedFile[],
): string {
	let result = taskDescription;

	// Replace {files} with bullet list of all paths
	if (result.includes('{files}')) {
		const fileList = downloadedFiles
			.map((f) => `- ${f.relativePath}`)
			.join('\n');
		result = result.replace(/\{files\}/g, fileList);
	}

	// Replace {files:paths} with comma-separated paths
	if (result.includes('{files:paths}')) {
		const paths = downloadedFiles.map((f) => f.relativePath).join(', ');
		result = result.replace(/\{files:paths\}/g, paths);
	}

	// Replace {files:names} with comma-separated filenames
	if (result.includes('{files:names}')) {
		const names = downloadedFiles.map((f) => f.fileName).join(', ');
		result = result.replace(/\{files:names\}/g, names);
	}

	// Replace {propertyName} with specific file path
	for (const file of downloadedFiles) {
		const placeholder = new RegExp(`\\{${file.propertyName}\\}`, 'g');
		result = result.replace(placeholder, file.relativePath);
	}

	return result;
}

/**
 * Build file list context to append to task description
 */
function buildFileListContext(
	downloadedFiles: DownloadedFile[],
	inputDirectory: string,
): string {
	if (downloadedFiles.length === 0) {
		return '';
	}

	const fileList = downloadedFiles
		.map((f) => {
			const sizeStr = f.size ? ` (${formatFileSize(f.size)})` : '';
			return `  - ${f.fileName}${sizeStr}`;
		})
		.join('\n');

	return `\n\n---\nInput files available in ${inputDirectory}/:\n${fileList}`;
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
