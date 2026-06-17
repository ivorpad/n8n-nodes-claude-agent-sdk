export function buildDurableStreamKey(args: {
	executionId: string;
	itemIndex: number;
}): string {
	return `stream:${args.executionId}:${args.itemIndex}`;
}
