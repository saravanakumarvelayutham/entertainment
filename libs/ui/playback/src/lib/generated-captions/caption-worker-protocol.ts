export const CAPTION_MAX_SAMPLES = 80_000;
export const CAPTION_MAX_TEXT_LENGTH = 2_000;

export type CaptionWorkerRequest =
    | { id: number; type: 'load'; runtimeBase: string }
    | { id: number; type: 'transcribe'; samples: Float32Array };

export type CaptionWorkerResponse =
    | { id: number; type: 'ready' }
    | { id: number; type: 'progress'; percent: number | null }
    | { id: number; type: 'result'; text: string }
    | {
          id: number;
          type: 'error';
          code: 'load' | 'inference' | 'invalid' | 'busy';
      };

export function isCaptionSamples(value: unknown): value is Float32Array {
    return (
        value instanceof Float32Array &&
        value.length > 0 &&
        value.length <= CAPTION_MAX_SAMPLES &&
        value.every(
            (sample) => Number.isFinite(sample) && Math.abs(sample) <= 1
        )
    );
}

export function isCaptionRequestId(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
}

export function isCaptionWorkerResponse(
    value: unknown
): value is CaptionWorkerResponse {
    if (!value || typeof value !== 'object') return false;
    const data = value as Record<string, unknown>;
    if (!isCaptionRequestId(data['id'])) return false;
    switch (data['type']) {
        case 'ready':
            return true;
        case 'progress':
            return (
                data['percent'] === null ||
                (typeof data['percent'] === 'number' &&
                    Number.isFinite(data['percent']) &&
                    data['percent'] >= 0 &&
                    data['percent'] <= 100)
            );
        case 'result':
            return (
                typeof data['text'] === 'string' &&
                data['text'].length <= CAPTION_MAX_TEXT_LENGTH
            );
        case 'error':
            return ['load', 'inference', 'invalid', 'busy'].includes(
                data['code'] as string
            );
        default:
            return false;
    }
}
