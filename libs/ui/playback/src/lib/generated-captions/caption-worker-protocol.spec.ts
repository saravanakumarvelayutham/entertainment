import {
    isCaptionRequestId,
    isCaptionSamples,
    isCaptionWorkerResponse,
} from './caption-worker-protocol';

describe('caption worker boundary', () => {
    it('accepts only bounded finite PCM samples', () => {
        expect(isCaptionSamples(new Float32Array(80_000))).toBe(true);
        for (const input of [
            [],
            null,
            new Float32Array(),
            new Float32Array(80_001),
            new Float32Array([Infinity]),
            new Float32Array([-1.1]),
        ]) {
            expect(isCaptionSamples(input)).toBe(false);
        }
    });
    it('checks request identities and response schemas', () => {
        expect(isCaptionRequestId(1)).toBe(true);
        for (const id of [
            0,
            -1,
            Infinity,
            1.1,
            '1',
            Number.MAX_SAFE_INTEGER + 1,
        ]) {
            expect(isCaptionRequestId(id)).toBe(false);
        }
        expect(isCaptionWorkerResponse({ id: 1, type: 'ready' })).toBe(true);
        expect(
            isCaptionWorkerResponse({ id: 1, type: 'result', text: 'Hello' })
        ).toBe(true);
        expect(
            isCaptionWorkerResponse({ id: 1, type: 'error', code: 'busy' })
        ).toBe(true);
        for (const response of [
            null,
            {},
            { id: 1, type: 'other' },
            { id: 1, type: 'progress', percent: NaN },
            { id: 1, type: 'progress', percent: -1 },
            { id: 1, type: 'error', code: 'remote error details' },
            { id: 1, type: 'result', text: 'x'.repeat(2001) },
        ]) {
            expect(isCaptionWorkerResponse(response)).toBe(false);
        }
    });
});
