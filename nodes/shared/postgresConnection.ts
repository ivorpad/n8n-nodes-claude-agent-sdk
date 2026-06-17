import { createServer, type AddressInfo, type Server } from 'node:net';

import { Pool, type PoolConfig } from 'pg';
import type { IExecuteFunctions, ISupplyDataFunctions, IWebhookFunctions, SSHCredentials } from 'n8n-workflow';

/**
 * Raw credential fields from n8n's built-in `postgres` credential type.
 * Kept loose because n8n credential shapes evolve across versions.
 */
export interface N8nPostgresCredential {
	host?: string;
	port?: number | string;
	database?: string;
	user?: string;
	password?: string;
	ssl?: 'allow' | 'disable' | 'require';
	allowUnauthorizedCerts?: boolean;
	maxConnections?: number;
	sshTunnel?: boolean;
	sshHost?: string;
	sshPort?: number;
	sshUser?: string;
	sshAuthenticateWith?: 'password' | 'privateKey';
	sshPassword?: string;
	privateKey?: string;
	passphrase?: string;
}

/**
 * Override fields from node UI parameters.
 * When present, these take precedence over n8n credential values.
 */
interface PostgresOverrideConfig {
	host?: string;
	port?: number;
	database?: string;
	user?: string;
	password?: string;
	ssl?: boolean;
}

/**
 * Handle returned by the connection factory.
 * Callers must call `close()` when done to release the pool and SSH tunnel.
 */
export interface PostgresConnectionHandle {
	pool: Pool;
	close: () => Promise<void>;
}

interface SshClientLike {
	forwardOut(
		srcIP: string,
		srcPort: number,
		dstIP: string,
		dstPort: number,
		callback: (error: Error | undefined, clientChannel: NodeJS.ReadWriteStream) => void,
	): void;
}

function hasSshTunnelHelpers(
	helpers: IExecuteFunctions['helpers'] | ISupplyDataFunctions['helpers'] | IWebhookFunctions['helpers'],
): helpers is IExecuteFunctions['helpers'] & {
	getSSHClient(credentials: SSHCredentials, abortController?: AbortController): Promise<SshClientLike>;
} {
	return 'getSSHClient' in helpers && typeof helpers.getSSHClient === 'function';
}

/**
 * Build SSL config from n8n credential fields, following the same logic as
 * n8n's built-in Postgres transport (packages/nodes-base/nodes/Postgres/transport/index.ts).
 */
function buildSslConfig(
	credential: N8nPostgresCredential,
	overrides?: PostgresOverrideConfig,
): PoolConfig['ssl'] {
	// If node-level override is explicitly set, use it
	if (overrides?.ssl !== undefined) {
		if (!overrides.ssl) return false;
		// When override enables SSL, check if credential allows unauthorized certs
		if (credential.allowUnauthorizedCerts === true) {
			return { rejectUnauthorized: false };
		}
		return true;
	}

	// Follow n8n's Postgres transport logic:
	// 1. If allowUnauthorizedCerts is true, use SSL with rejectUnauthorized: false
	if (credential.allowUnauthorizedCerts === true) {
		return { rejectUnauthorized: false };
	}

	// 2. Otherwise, ssl is enabled unless mode is 'disable' or undefined
	const sslMode = credential.ssl;
	if (!sslMode || sslMode === 'disable') {
		return false;
	}

	return true;
}

/**
 * Resolve effective connection parameters with override precedence:
 *   node overrides > credential values > environment defaults
 */
function resolveConnectionParams(
	credential: N8nPostgresCredential,
	overrides?: PostgresOverrideConfig,
): { host: string; port: number; database: string; user: string; password: string } {
	return {
		host: overrides?.host || (credential.host as string) || process.env.PGHOST || 'localhost',
		port: overrides?.port || Number(credential.port) || Number(process.env.PGPORT) || 5432,
		database: overrides?.database || (credential.database as string) || process.env.PGDATABASE || 'postgres',
		user: overrides?.user || (credential.user as string) || process.env.PGUSER || process.env.USER || 'postgres',
		password: overrides?.password || (credential.password as string) || process.env.PGPASSWORD || '',
	};
}

/**
 * Create a PostgresConnectionHandle with proper SSL and SSH tunnel support.
 *
 * This factory follows the same patterns as n8n's built-in Postgres transport:
 * - SSL modes: allow/disable/require + allowUnauthorizedCerts
 * - SSH tunneling via helpers.getSSHClient() with local TCP proxy
 *
 * The handle MUST be closed when done to release the pool and SSH resources.
 */
export async function createPostgresConnectionHandle(input: {
	execFunctions: IExecuteFunctions | ISupplyDataFunctions | IWebhookFunctions;
	credential: N8nPostgresCredential;
	overrides?: PostgresOverrideConfig;
}): Promise<PostgresConnectionHandle> {
	const { execFunctions, credential, overrides } = input;
	const connParams = resolveConnectionParams(credential, overrides);
	const ssl = buildSslConfig(credential, overrides);

	const poolConfig: PoolConfig = {
		host: connParams.host,
		port: connParams.port,
		database: connParams.database,
		user: connParams.user,
		password: connParams.password,
		ssl,
		keepAlive: true,
	};

	// When SSH tunnel is enabled in the credential, set up a local TCP proxy
	if (credential.sshTunnel === true) {
		return createSshTunnelConnection(execFunctions, credential, poolConfig, connParams);
	}

	// Direct connection (no SSH tunnel)
	const pool = new Pool(poolConfig);
	return {
		pool,
		close: async () => {
			await pool.end();
		},
	};
}

/**
 * Create a connection through an SSH tunnel using n8n's built-in SSH helpers.
 */
async function createSshTunnelConnection(
	execFunctions: IExecuteFunctions | ISupplyDataFunctions | IWebhookFunctions,
	credential: N8nPostgresCredential,
	poolConfig: PoolConfig,
	connParams: { host: string; port: number },
): Promise<PostgresConnectionHandle> {
	const abortController = new AbortController();

	// Build SSH credentials in the format n8n's getSSHClient expects
	const sshBase = {
		sshHost: credential.sshHost || '',
		sshPort: Number(credential.sshPort) || 22,
		sshUser: credential.sshUser || '',
	};
	const sshCredentials: SSHCredentials = credential.sshAuthenticateWith === 'privateKey'
		? {
				...sshBase,
				sshAuthenticateWith: 'privateKey',
				privateKey: credential.privateKey || '',
				...(credential.passphrase ? { passphrase: credential.passphrase } : {}),
			}
		: {
				...sshBase,
				sshAuthenticateWith: 'password',
				sshPassword: credential.sshPassword || '',
			};

	const helperBag = execFunctions.helpers;
	if (!hasSshTunnelHelpers(helperBag)) {
		throw new Error('SSH tunneling is not available in this execution context');
	}

	const sshClient = await helperBag.getSSHClient(sshCredentials, abortController);

	// Create a local TCP proxy that forwards to the Postgres host through SSH
	const proxy: Server = createServer();

	proxy.on('error', () => {
		abortController.abort();
	});

	proxy.on('close', () => {
		abortController.abort();
	});

	abortController.signal.addEventListener('abort', () => {
		proxy.close();
	});

	const proxyPort = await new Promise<number>((resolve) => {
		proxy.listen(0, '127.0.0.1', () => {
			resolve((proxy.address() as AddressInfo).port);
		});
	});

	proxy.on('connection', (localSocket) => {
		sshClient.forwardOut(
			'127.0.0.1',
			localSocket.remotePort!,
			connParams.host,
			connParams.port,
			(error: Error | undefined, clientChannel: NodeJS.ReadWriteStream) => {
				if (error) {
					abortController.abort();
				} else {
					localSocket.pipe(clientChannel);
					clientChannel.pipe(localSocket);
				}
			},
		);
	});

	// Point the pool at the local proxy instead of the remote host
	const pool = new Pool({
		...poolConfig,
		host: '127.0.0.1',
		port: proxyPort,
	});

	return {
		pool,
		close: async () => {
			try {
				await pool.end();
			} catch {
				// Pool may already be closed
			}
			abortController.abort();
		},
	};
}
