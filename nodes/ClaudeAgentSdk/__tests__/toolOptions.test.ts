import { describe, expect, it } from 'vitest';

import { TOOL_OPTIONS, buildToolOptions, discoverMcpTools } from '../toolOptions';

describe('tool options', () => {
	it('includes ToolSearch in the built-in tool list', () => {
		expect(TOOL_OPTIONS.some((option) => option.value === 'ToolSearch')).toBe(true);
	});

	it('includes current Task tools while keeping TodoWrite selectable for historical runs', () => {
		const values = TOOL_OPTIONS.map((option) => option.value);

		expect(values).toEqual(expect.arrayContaining([
			'TaskCreate',
			'TaskUpdate',
			'TaskGet',
			'TaskList',
			'TodoWrite',
		]));
	});

	it('includes built-in tools added by current SDK schemas', () => {
		const values = TOOL_OPTIONS.map((option) => option.value);

		expect(values).toEqual(expect.arrayContaining([
			'Artifact',
			'ReadMcpResourceDir',
			'ReportFindings',
		]));
		expect(TOOL_OPTIONS.find((option) => option.value === 'Monitor')?.description)
			.toContain('websocket');
	});

	it('adds discovered MCP tools for governed selectors', () => {
		const options = buildToolOptions(
			{},
			[
				{
					value: 'mcp__privacy__list_subject_records',
					description: 'List subject records from the privacy MCP server',
				},
			],
		);

		expect(options).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					value: 'mcp__privacy__list_subject_records',
					description: 'List subject records from the privacy MCP server',
				}),
			]),
		);
	});

	it('keeps configured AGT and HITL MCP tools selectable if discovery fails', () => {
		const options = buildToolOptions({
			toolsRequiringApproval: ['mcp__privacy__export_subject_bundle'],
			securityOptions: {
				agtGovernance: {
					settings: {
						rules: {
							values: [
								{ tools: ['mcp__privacy__get_request'] },
							],
						},
					},
				},
			},
		});

		expect(options).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ value: 'mcp__privacy__export_subject_bundle' }),
				expect.objectContaining({ value: 'mcp__privacy__get_request' }),
			]),
		);
	});

	it('keeps configured allowed and disallowed MCP tools selectable if discovery fails', () => {
		const options = buildToolOptions({
			allowedTools: ['mcp__exa__web_search_exa'],
			disallowedTools: ['mcp__privacy__delete_subject_record'],
		});

		expect(options).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ value: 'mcp__exa__web_search_exa' }),
				expect.objectContaining({ value: 'mcp__privacy__delete_subject_record' }),
			]),
		);
	});

	it('discovers tools only when MCP servers are enabled', async () => {
		let discoveryCalls = 0;
		const discoverer = async () => {
			discoveryCalls += 1;
			return [{ value: 'mcp__privacy__list_subject_records' }];
		};

		const tools = await discoverMcpTools(
			{
				enableMcpServers: true,
				mcpServers: {
					servers: [
						{
							name: 'privacy',
							type: 'http',
							url: 'http://localhost:3457/mcp',
						},
					],
				},
			},
			{
				async getCredentials() {
					return undefined;
				},
			},
			discoverer,
		);

		expect(discoveryCalls).toBe(1);
		expect(tools).toEqual([{ value: 'mcp__privacy__list_subject_records' }]);
	});

	it('skips MCP discovery when the server list is disabled', async () => {
		let discoveryCalls = 0;
		const discoverer = async () => {
			discoveryCalls += 1;
			return [{ value: 'mcp__privacy__list_subject_records' }];
		};

		const tools = await discoverMcpTools(
			{
				enableMcpServers: false,
				mcpServers: {
					servers: [
						{
							name: 'privacy',
							type: 'http',
							url: 'http://localhost:3457/mcp',
						},
					],
				},
			},
			{
				async getCredentials() {
					return undefined;
				},
			},
			discoverer,
		);

		expect(discoveryCalls).toBe(0);
		expect(tools).toEqual([]);
	});
});
