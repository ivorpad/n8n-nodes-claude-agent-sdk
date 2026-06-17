import {
	NodeConnectionTypes,
	type INodeType,
	type INodeTypeDescription,
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

// Session memory interface — tracks deterministic session existence + metadata.
export interface ISessionMemory {
	has(sessionId: string): Promise<boolean>;
	getMetadata?(sessionId: string): Promise<{ workingDirectory?: string; managedAgentSessionId?: string } | undefined>;
	forget?(sessionId: string): Promise<void>;
	acquireExecutionLock?(sessionId: string): Promise<() => Promise<void>>;
	touch(
		sessionId: string,
		parentNodeName?: string,
		metadata?: { workingDirectory?: string; managedAgentSessionId?: string },
	): Promise<void>;
	type: 'claude-session-memory';
}

// Singleton to persist sessions across workflow executions
type SessionEntry = {
	parentNodeName: string;
	workingDirectory?: string;
	managedAgentSessionId?: string;
	lastAccessed: Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasParentNode(
	ctx: ISupplyDataFunctions,
): ctx is ISupplyDataFunctions & { parentNode: { name: string } } {
	const parentNode = Reflect.get(ctx, 'parentNode');
	return (
		isRecord(parentNode)
		&& typeof parentNode.name === 'string'
	);
}

class SessionMemorySingleton {
	private static instance: SessionMemorySingleton;
	private sessions: Map<string, SessionEntry>;

	private constructor() {
		this.sessions = new Map();
	}

	static getInstance(): SessionMemorySingleton {
		if (!SessionMemorySingleton.instance) {
			SessionMemorySingleton.instance = new SessionMemorySingleton();
		}
		return SessionMemorySingleton.instance;
	}

	async getEntry(key: string): Promise<SessionEntry | undefined> {
		this.cleanupStale();
		const entry = this.sessions.get(key);
		if (entry) {
			entry.lastAccessed = new Date();
		}
		return entry;
	}

	async has(key: string): Promise<boolean> {
		const entry = await this.getEntry(key);
		return Boolean(entry);
	}

	async touch(
		key: string,
		parentNodeName?: string,
		metadata?: { workingDirectory?: string; managedAgentSessionId?: string },
	): Promise<void> {
		const existing = this.sessions.get(key);
		this.sessions.set(key, {
			parentNodeName: parentNodeName || existing?.parentNodeName || 'default',
			workingDirectory: metadata?.workingDirectory ?? existing?.workingDirectory,
			managedAgentSessionId: metadata?.managedAgentSessionId ?? existing?.managedAgentSessionId,
			lastAccessed: new Date(),
		});
	}

	private cleanupStale(): void {
		const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
		for (const [key, entry] of this.sessions.entries()) {
			if (entry.lastAccessed < oneHourAgo) {
				this.sessions.delete(key);
			}
		}
	}
}

export class SimpleSessionMemory implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Simple Session Memory',
		name: 'simpleSessionMemory',
		icon: 'file:simple-session-memory.svg',
		group: ['transform'],
		version: 1,
		description: 'Tracks session existence and metadata in memory (single process) for deterministic session resume',
		defaults: {
			name: 'Simple Session Memory',
		},
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Memory'],
			},
		},
		inputs: [],
		outputs: [NodeConnectionTypes.AiMemory],
		outputNames: ['Memory'],
		properties: [
			{
				displayName: 'Session TTL (Hours)',
				name: 'sessionTTL',
				type: 'number',
				default: 1,
				description: 'How long to keep sessions in memory (in hours). Set to 0 for no expiration.',
			},
		],
		usableAsTool: true,
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		void itemIndex;
		const workflowId = this.getWorkflow().id;
		const memoryInstance = SessionMemorySingleton.getInstance();

		// Get parent node name for namespacing (e.g., "Claude Agent SDK HR" -> "Claude_Agent_SDK_HR")
		const parentNodeName = hasParentNode(this)
			? this.parentNode.name.replace(/\s+/g, '_')
			: 'default';

		const sessionMemory: ISessionMemory = {
			type: 'claude-session-memory',
			async has(sessionId: string): Promise<boolean> {
				// Key is workflowId + sessionId only (not parentNodeName) so renaming nodes doesn't break sessions
				const key = `${workflowId}__${sessionId}`;
				return memoryInstance.has(key);
			},
			async getMetadata(sessionId: string): Promise<{ workingDirectory?: string; managedAgentSessionId?: string } | undefined> {
				const key = `${workflowId}__${sessionId}`;
				const entry = await memoryInstance.getEntry(key);
				if (!entry) return undefined;
				return {
					...(entry.workingDirectory && { workingDirectory: entry.workingDirectory }),
					...(entry.managedAgentSessionId && { managedAgentSessionId: entry.managedAgentSessionId }),
				};
			},
			async touch(
				sessionId: string,
				nodeNameForAnalytics?: string,
				metadata?: { workingDirectory?: string; managedAgentSessionId?: string },
			): Promise<void> {
				// Key is workflowId + sessionId only; parentNodeName stored separately for analytics
				const key = `${workflowId}__${sessionId}`;
				await memoryInstance.touch(key, nodeNameForAnalytics || parentNodeName, metadata);
			},
		};

		return {
			response: sessionMemory,
		};
	}
}
