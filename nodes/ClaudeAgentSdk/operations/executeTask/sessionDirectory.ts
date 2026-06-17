// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import * as fs from 'fs';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import * as path from 'path';

interface TranscriptDirectoryResolutionInput {
	defaultWorkingDirectory: string;
	mappedWorkingDirectory?: string;
	resumeSessionId?: string;
	executionSessionId?: string;
}

export function resolveClaudeConfigDirectory(override?: string): string {
	const trimmedOverride = override?.trim();
	if (trimmedOverride) {
		return trimmedOverride;
	}

	const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
	if (envConfigDir) {
		return envConfigDir;
	}

	const homeDir = process.env.HOME?.trim() || '/root';
	return path.join(homeDir, '.claude');
}

export function findSessionTranscriptPath(args: {
	claudeConfigDirectory: string;
	sessionId: string;
}): string | undefined {
	const { claudeConfigDirectory, sessionId } = args;
	const normalizedSessionId = sessionId.trim();
	if (!normalizedSessionId) {
		return undefined;
	}

	const projectsDirectory = path.join(claudeConfigDirectory, 'projects');
	const targetFilename = `${normalizedSessionId}.jsonl`;

	let bucketEntries: fs.Dirent[];
	try {
		bucketEntries = fs.readdirSync(projectsDirectory, { withFileTypes: true });
	} catch {
		return undefined;
	}

	for (const entry of bucketEntries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const candidatePath = path.join(projectsDirectory, entry.name, targetFilename);
		if (fs.existsSync(candidatePath)) {
			return candidatePath;
		}
	}

	return undefined;
}

/**
 * For resumed sessions, Claude keeps transcript artifacts under the original
 * project bucket. When the execution session ID is unchanged, preserve that
 * mapped directory as the canonical artifact location.
 */
export function resolveTranscriptWorkingDirectory(input: TranscriptDirectoryResolutionInput): string {
	const {
		defaultWorkingDirectory,
		mappedWorkingDirectory,
		resumeSessionId,
		executionSessionId,
	} = input;

	if (mappedWorkingDirectory && resumeSessionId && !executionSessionId) {
		return mappedWorkingDirectory;
	}

	if (
		mappedWorkingDirectory
		&& resumeSessionId
		&& executionSessionId
		&& resumeSessionId === executionSessionId
	) {
		return mappedWorkingDirectory;
	}

	return defaultWorkingDirectory;
}
