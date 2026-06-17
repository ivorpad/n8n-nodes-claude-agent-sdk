/**
 * Editor-time MCP tool discovery for the tools dropdowns: JSON-RPC handshake
 * against configured HTTP MCP servers plus shared parsing helpers.
 */

import type { ILoadOptionsFunctions } from 'n8n-workflow';

import type { McpServerUI, McpServerUIHttp } from './types';

export interface DiscoveredToolOption {
	value: string;
	description?: string;
}

export type McpToolDiscoverer = (
	server: McpServerUI,
	headers?: Record<string, string>,
) => Promise<DiscoveredToolOption[]>;

const MCP_DISCOVERY_TIMEOUT_MS = 2000;
const MCP_PROTOCOL_VERSION = '2025-11-25';
const MCP_SESSION_HEADER = 'mcp-session-id';
const MCP_PROTOCOL_HEADER = 'mcp-protocol-version';
const MCP_ACCEPT_HEADER = 'application/json, text/event-stream';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	return Object.fromEntries(Object.entries(value));
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function parseJsonStringMap(value: string | undefined): Record<string, string> | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value);
		const record = asRecord(parsed);
		if (!record) {
			return undefined;
		}

		const entries = Object.entries(record).filter((entry): entry is [string, string] => (
			typeof entry[1] === 'string' && entry[1].trim() !== ''
		));

		return entries.length > 0 ? Object.fromEntries(entries) : undefined;
	} catch {
		return undefined;
	}
}

function buildMcpToolValue(serverName: string, toolName: string): string {
	return `mcp__${serverName}__${toolName}`;
}

function isToolBlockedOnServer(server: McpServerUI, toolName: string): boolean {
	if (server.toolPermissions !== 'block' || !server.blockedTools) {
		return false;
	}

	const prefixedToolName = buildMcpToolValue(server.name, toolName);

	return server.blockedTools
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.some((entry) => entry === toolName || entry === prefixedToolName);
}

function buildRequestHeaders(
	headers: Record<string, string> | undefined,
	args: { protocolVersion?: string; sessionId?: string },
): Headers {
	const requestHeaders = new Headers(headers);
	requestHeaders.set('accept', MCP_ACCEPT_HEADER);
	requestHeaders.set('content-type', 'application/json');

	if (args.protocolVersion) {
		requestHeaders.set(MCP_PROTOCOL_HEADER, args.protocolVersion);
	}

	if (args.sessionId) {
		requestHeaders.set(MCP_SESSION_HEADER, args.sessionId);
	}

	return requestHeaders;
}

function buildJsonRpcRequest(
	method: string,
	args: { id?: string; params?: Record<string, unknown> },
): Record<string, unknown> {
	const request: Record<string, unknown> = {
		jsonrpc: '2.0',
		method,
	};

	if (args.id) {
		request.id = args.id;
	}

	if (args.params) {
		request.params = args.params;
	}

	return request;
}

function extractJsonRpcMessage(value: unknown): Record<string, unknown> | undefined {
	if (Array.isArray(value)) {
		for (const entry of value) {
			const record = asRecord(entry);
			if (record) {
				return record;
			}
		}
		return undefined;
	}

	return asRecord(value);
}

function extractSseJsonPayload(value: string): unknown {
	const events = value.split(/\r?\n\r?\n/);

	for (const event of events) {
		const dataLines = event
			.split(/\r?\n/)
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice('data:'.length).trimStart())
			.filter(Boolean);

		if (dataLines.length === 0) {
			continue;
		}

		try {
			return JSON.parse(dataLines.join('\n'));
		} catch {
			continue;
		}
	}

	return undefined;
}

async function extractJsonRpcResponse(response: Response): Promise<Record<string, unknown>> {
	const contentType = response.headers.get('content-type') ?? '';

	if (contentType.includes('application/json')) {
		const body = await response.json();
		const message = extractJsonRpcMessage(body);
		if (message) {
			return message;
		}
		throw new Error('MCP discovery returned an invalid JSON-RPC response');
	}

	if (contentType.includes('text/event-stream')) {
		const body = await response.text();
		const payload = extractSseJsonPayload(body);
		const message = extractJsonRpcMessage(payload);
		if (message) {
			return message;
		}
		throw new Error('MCP discovery returned an invalid event stream response');
	}

	throw new Error(`Unexpected MCP discovery content type: ${contentType || 'unknown'}`);
}

function extractJsonRpcResult(message: Record<string, unknown>, method: string): unknown {
	const error = asRecord(message.error);
	if (error) {
		const reason = readString(error, 'message') ?? `Unknown ${method} error`;
		throw new Error(`MCP ${method} failed: ${reason}`);
	}

	if (!Object.prototype.hasOwnProperty.call(message, 'result')) {
		throw new Error(`MCP ${method} returned no result`);
	}

	return message.result;
}

function parseInitializeResult(value: unknown): { protocolVersion?: string } {
	const result = asRecord(value);
	if (!result) {
		return {};
	}

	return {
		protocolVersion: readString(result, 'protocolVersion'),
	};
}

function parseListToolsResult(server: McpServerUIHttp, value: unknown): DiscoveredToolOption[] {
	const result = asRecord(value);
	const tools = result?.tools;

	if (!Array.isArray(tools)) {
		return [];
	}

	return tools.flatMap((entry) => {
		const tool = asRecord(entry);
		if (!tool) {
			return [];
		}

		const name = readString(tool, 'name');
		if (!name || isToolBlockedOnServer(server, name)) {
			return [];
		}

		return [{
			value: buildMcpToolValue(server.name, name),
			description: readString(tool, 'description') ?? `Tool from MCP server "${server.name}"`,
		}];
	});
}

async function postJsonRpc(
	url: string,
	body: Record<string, unknown>,
	headers: Record<string, string> | undefined,
	args: { protocolVersion?: string; sessionId?: string },
): Promise<{ message?: Record<string, unknown>; sessionId?: string }> {
	const response = await fetch(url, {
		method: 'POST',
		headers: buildRequestHeaders(headers, args),
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(MCP_DISCOVERY_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`MCP discovery request failed with HTTP ${response.status}`);
	}

	const sessionId = response.headers.get(MCP_SESSION_HEADER) ?? args.sessionId;

	if (response.status === 202 || response.status === 204) {
		await response.body?.cancel();
		return { sessionId };
	}

	return {
		message: await extractJsonRpcResponse(response),
		sessionId,
	};
}

async function closeHttpDiscoverySession(
	url: string,
	headers: Record<string, string> | undefined,
	args: { protocolVersion?: string; sessionId?: string },
): Promise<void> {
	if (!args.sessionId) {
		return;
	}

	const response = await fetch(url, {
		method: 'DELETE',
		headers: buildRequestHeaders(headers, args),
		signal: AbortSignal.timeout(MCP_DISCOVERY_TIMEOUT_MS),
	});

	await response.body?.cancel();
}

async function discoverHttpServerTools(
	server: McpServerUIHttp,
	headers: Record<string, string> | undefined,
): Promise<DiscoveredToolOption[]> {
	let sessionId: string | undefined;
	let negotiatedProtocolVersion: string | undefined;

	try {
		const initializeResponse = await postJsonRpc(
			server.url,
			buildJsonRpcRequest('initialize', {
				id: crypto.randomUUID(),
				params: {
					protocolVersion: MCP_PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: {
						name: 'n8n-claude-agent-sdk',
						version: '0.2.18',
					},
				},
			}),
			headers,
			{},
		);

		const initializeMessage = initializeResponse.message;
		if (!initializeMessage) {
			throw new Error('MCP initialize returned no response payload');
		}

		sessionId = initializeResponse.sessionId;
		negotiatedProtocolVersion = parseInitializeResult(
			extractJsonRpcResult(initializeMessage, 'initialize'),
		).protocolVersion ?? MCP_PROTOCOL_VERSION;

		await postJsonRpc(
			server.url,
			buildJsonRpcRequest('notifications/initialized', {}),
			headers,
			{
				protocolVersion: negotiatedProtocolVersion,
				sessionId,
			},
		);

		const listToolsResponse = await postJsonRpc(
			server.url,
			buildJsonRpcRequest('tools/list', {
				id: crypto.randomUUID(),
				params: {},
			}),
			headers,
			{
				protocolVersion: negotiatedProtocolVersion,
				sessionId,
			},
		);

		const listToolsMessage = listToolsResponse.message;
		if (!listToolsMessage) {
			throw new Error('MCP tools/list returned no response payload');
		}

		return parseListToolsResult(
			server,
			extractJsonRpcResult(listToolsMessage, 'tools/list'),
		);
	} finally {
		try {
			await closeHttpDiscoverySession(server.url, headers, {
				protocolVersion: negotiatedProtocolVersion,
				sessionId,
			});
		} catch {
			// Ignore session teardown failures during editor-side discovery.
		}
	}
}

export async function discoverServerTools(
	server: McpServerUI,
	headers: Record<string, string> | undefined,
): Promise<DiscoveredToolOption[]> {
	if (server.type !== 'http') {
		return [];
	}

	return await discoverHttpServerTools(server, headers);
}

export async function resolveMcpHeaders(
	ctx: Pick<ILoadOptionsFunctions, 'getCredentials'>,
	server: McpServerUI,
): Promise<Record<string, string> | undefined> {
	if (server.type === 'stdio') {
		return undefined;
	}

	if (server.authentication === 'custom') {
		return parseJsonStringMap(server.headers);
	}

	if (server.authentication !== 'credential') {
		return undefined;
	}

	try {
		const credentials = await ctx.getCredentials('mcpHeaderAuthApi');
		const credential = asRecord(credentials);
		const headerName = credential ? readString(credential, 'headerName') : undefined;
		const headerValue = credential ? readString(credential, 'headerValue') : undefined;

		if (!headerName || !headerValue) {
			return undefined;
		}

		return { [headerName]: headerValue };
	} catch {
		return undefined;
	}
}
