import { describe, expect, it } from 'vitest';

import { InvocationObservabilityCollector } from '../../operations/executeTask/observability';
import { createSecretsRedactor } from '../../operations/executeTask/secretsRedaction';

describe('InvocationObservabilityCollector', () => {
	it('masks secret values in recorded payloads, not just truncates them', () => {
		const collector = new InvocationObservabilityCollector({
			mode: 'full',
			maxEvents: 10,
			maxBytes: 8192,
			redactPayloads: true,
			secretRedactor: createSecretsRedactor(['sk-obs-secret-999']),
			context: { nodeName: 'Test Node', itemIndex: 0 },
		});

		collector.record({
			eventType: 'tool.call.detected',
			status: 'detected',
			payload: {
				header: 'Authorization: sk-obs-secret-999',
				nested: { token: 'sk-obs-secret-999' },
			},
		});

		const result = collector.toTaskResultObservability();
		expect(result.events).toHaveLength(1);
		const serialized = JSON.stringify(result.events[0].payload);
		expect(serialized).not.toContain('sk-obs-secret-999');
		expect(serialized).toContain('[REDACTED]');
	});

	it('omits payload details in summary mode', () => {
		const collector = new InvocationObservabilityCollector({
			mode: 'summary',
			maxEvents: 10,
			maxBytes: 4096,
			redactPayloads: true,
			context: { nodeName: 'Test Node', itemIndex: 0 },
		});

		collector.record({
			eventType: 'test.event',
			status: 'ok',
			payload: {
				secret: 'value',
			},
		});

		const result = collector.toTaskResultObservability();
		expect(result.events).toHaveLength(1);
		expect(result.events[0].payload).toBeUndefined();
		expect(result.summary.mode).toBe('summary');
	});

	it('enforces max event count and tracks truncation', () => {
		const collector = new InvocationObservabilityCollector({
			mode: 'full',
			maxEvents: 2,
			maxBytes: 4096,
			redactPayloads: true,
			context: { nodeName: 'Test Node', itemIndex: 0 },
		});

		collector.record({ eventType: 'one', status: 'ok' });
		collector.record({ eventType: 'two', status: 'ok' });
		collector.record({ eventType: 'three', status: 'ok' });

		const result = collector.toTaskResultObservability();
		expect(result.events).toHaveLength(2);
		expect(result.events[0].eventType).toBe('two');
		expect(result.events[1].eventType).toBe('three');
		expect(result.summary.truncated).toBe(true);
		expect(result.summary.droppedEvents).toBe(1);
	});

	it('ingests tool calls and MCP log events', () => {
		const collector = new InvocationObservabilityCollector({
			mode: 'full',
			maxEvents: 20,
			maxBytes: 4096,
			redactPayloads: true,
			context: { nodeName: 'Test Node', itemIndex: 0, executionId: 'exec-1' },
		});

		collector.recordToolCalls([
			{ tool: 'Read', input: { file_path: '/tmp/a.ts' } },
		]);
		collector.recordN8nMcpEvents([
			{ level: 'info', message: 'hello', timestamp: new Date().toISOString() },
		]);

		const result = collector.toTaskResultObservability();
		expect(result.summary.eventCount).toBe(2);
		expect(result.summary.eventsByType['tool.call.detected']).toBe(1);
		expect(result.summary.eventsByType['mcp.log']).toBe(1);
		expect(result.events.every((event) => event.executionId === 'exec-1')).toBe(true);
	});
});

