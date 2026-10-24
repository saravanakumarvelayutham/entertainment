import { jest } from '@jest/globals';
import { createCaptionWorker } from './caption-worker-factory';

describe('browser caption worker factory', () => {
    it('creates the bundled inference worker as a module', () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
        const worker = {};
        const constructor = jest.fn(function () {
            return worker;
        });
        Object.defineProperty(globalThis, 'Worker', {
            configurable: true,
            value: constructor,
        });
        try {
            expect(createCaptionWorker()).toBe(worker);
            const [url, options] = constructor.mock.calls[0] as unknown as [
                URL,
                WorkerOptions,
            ];
            expect(url.pathname).toMatch(/\/caption-inference\.worker$/);
            expect(options).toEqual({ type: 'module' });
        } finally {
            if (original) Object.defineProperty(globalThis, 'Worker', original);
            else Reflect.deleteProperty(globalThis, 'Worker');
        }
    });
});
