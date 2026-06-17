/**
 * Streaming Output Tests - Format
 *
 * Tests for parsing and validating streaming output format.
 * Uses the mock streaming.jsonl data to validate output parsing.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Load mock streaming data
const mockDataPath = path.join(__dirname, '../mocks/streaming.jsonl');
const mockStreamingData = fs.existsSync(mockDataPath)
	? fs.readFileSync(mockDataPath, 'utf-8')
			.split('\n')
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line))
	: [];

describe('Streaming Output Format', () => {
	describe('Mock Data Structure', () => {
		it('should have mock streaming data loaded', () => {
			expect(mockStreamingData.length).toBeGreaterThan(0);
		});

		it('should have begin message', () => {
			const beginMsg = mockStreamingData.find((m) => m.type === 'begin');
			expect(beginMsg).toBeDefined();
			expect(beginMsg.metadata).toBeDefined();
			expect(beginMsg.metadata.nodeId).toBeDefined();
			expect(beginMsg.metadata.nodeName).toBeDefined();
		});

		it('should have item messages', () => {
			const itemMsgs = mockStreamingData.filter((m) => m.type === 'item');
			expect(itemMsgs.length).toBeGreaterThan(0);
		});

		it('should have end message', () => {
			const endMsg = mockStreamingData.find((m) => m.type === 'end');
			expect(endMsg).toBeDefined();
		});

		it('should have metadata in all messages', () => {
			mockStreamingData.forEach((msg) => {
				expect(msg.metadata).toBeDefined();
				expect(msg.metadata.timestamp).toBeDefined();
			});
		});
	});

	describe('Tool Call Markers in Output', () => {
		it('should contain tool call markers in streamed content', () => {
			const itemsWithToolCalls = mockStreamingData
				.filter((m) => m.type === 'item')
				.filter((m) => m.content?.includes('[TOOL_CALL:'));

			expect(itemsWithToolCalls.length).toBeGreaterThan(0);
		});

		it('should have parseable JSON in tool call markers', () => {
			const itemsWithToolCalls = mockStreamingData
				.filter((m) => m.type === 'item')
				.filter((m) => m.content?.includes('[TOOL_CALL:'));

			itemsWithToolCalls.forEach((item) => {
				// Extract JSON from marker
				const match = item.content.match(/\[TOOL_CALL:(\{[^}]+\})\]/);
				if (match) {
					expect(() => JSON.parse(match[1])).not.toThrow();
					const parsed = JSON.parse(match[1]);
					expect(parsed.name).toBeDefined();
					expect(parsed.id).toBeDefined();
				}
			});
		});

		it('should have closing tool call markers', () => {
			const itemsWithToolCalls = mockStreamingData
				.filter((m) => m.type === 'item')
				.filter((m) => m.content?.includes('[TOOL_CALL:'));

			itemsWithToolCalls.forEach((item) => {
				expect(item.content).toContain('[/TOOL_CALL]');
			});
		});
	});

	describe('Tool Result Markers in Output', () => {
		it('should contain tool result markers in streamed content', () => {
			const itemsWithToolResults = mockStreamingData
				.filter((m) => m.type === 'item')
				.filter((m) => m.content?.includes('[TOOL_RESULT:'));

			expect(itemsWithToolResults.length).toBeGreaterThan(0);
		});

		it('should have parseable JSON in tool result markers', () => {
			const itemsWithToolResults = mockStreamingData
				.filter((m) => m.type === 'item')
				.filter((m) => m.content?.includes('[TOOL_RESULT:'));

			itemsWithToolResults.forEach((item) => {
				// Extract JSON from marker
				const match = item.content.match(/\[TOOL_RESULT:(\{[^}]+\})\]/);
				if (match) {
					expect(() => JSON.parse(match[1])).not.toThrow();
					const parsed = JSON.parse(match[1]);
					expect(parsed.name).toBeDefined();
					expect(parsed.id).toBeDefined();
					expect(parsed.success).toBeDefined();
				}
			});
		});

		it('should have closing tool result markers', () => {
			const itemsWithToolResults = mockStreamingData
				.filter((m) => m.type === 'item')
				.filter((m) => m.content?.includes('[TOOL_RESULT:'));

			itemsWithToolResults.forEach((item) => {
				expect(item.content).toContain('[/TOOL_RESULT]');
			});
		});
	});

	describe('Text Streaming', () => {
		it('should have text content in item messages', () => {
			const textItems = mockStreamingData
				.filter((m) => m.type === 'item')
				.filter((m) => m.content && !m.content.includes('[TOOL_'));

			expect(textItems.length).toBeGreaterThan(0);
		});

		it('should have incremental text chunks', () => {
			// Text should be streamed in small chunks
			const textItems = mockStreamingData
				.filter((m) => m.type === 'item')
				.filter((m) => m.content && !m.content.includes('[TOOL_'));

			// At least some chunks should be short (incremental)
			const shortChunks = textItems.filter((item) => item.content.length < 50);
			expect(shortChunks.length).toBeGreaterThan(0);
		});
	});
});

