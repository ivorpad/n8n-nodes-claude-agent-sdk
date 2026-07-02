import { describe, expect, it } from 'vitest';

import { STREAMING_CONTENT_TYPE_OPTIONS } from '../../streaming/contentTypeOptions';
import type { StreamContentType } from '../../streaming/types';

describe('streaming content type options', () => {
	it('includes current SDK system message subtype filters', () => {
		const values = STREAMING_CONTENT_TYPE_OPTIONS.map((option) => option.value);
		const systemSubtypes = [
			'system:informational',
			'system:model_refusal_no_fallback',
			'system:permission_denied',
			'system:worker_shutting_down',
		] satisfies StreamContentType[];

		expect(values).toEqual(expect.arrayContaining(systemSubtypes));
	});
});
