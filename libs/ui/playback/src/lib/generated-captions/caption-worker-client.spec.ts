import { jest } from '@jest/globals';
import {
    CaptionWorkerClient,
    type CaptionWorker,
} from './caption-worker-client';
import type { CaptionWorkerRequest } from './caption-worker-protocol';

class FakeWorker {
    onmessage: Worker['onmessage'] = null;
    onerror: Worker['onerror'] = null;
    onmessageerror: Worker['onmessageerror'] = null;
    postMessage =
        jest.fn<
            (message: CaptionWorkerRequest, transfer?: Transferable[]) => void
        >();
    terminate = jest.fn();
    emit(data: unknown): void {
        this.onmessage?.call(
            this as unknown as Worker,
            { data } as MessageEvent
        );
    }
    fail(): void {
        this.onerror?.call(this as unknown as Worker, {} as ErrorEvent);
    }
}

describe('CaptionWorkerClient', () => {
    let worker: FakeWorker;
    let factory: ReturnType<typeof jest.fn<() => CaptionWorker>>;
    let client: CaptionWorkerClient;

    beforeEach(() => {
        jest.useFakeTimers();
        worker = new FakeWorker();
        factory = jest.fn(() => worker as unknown as CaptionWorker);
        client = new CaptionWorkerClient(factory);
    });
    afterEach(() => {
        client.dispose();
        jest.useRealTimers();
    });

    async function load(): Promise<void> {
        const promise = client.load(() => undefined);
        worker.emit({ id: 1, type: 'ready' });
        await promise;
    }

    it('creates the worker only on explicit load and ignores stale/malformed progress', async () => {
        expect(factory).not.toHaveBeenCalled();
        const progress = jest.fn();
        const pending = client.load(progress);
        expect(factory).toHaveBeenCalledTimes(1);
        expect(worker.postMessage.mock.calls[0][0]).toMatchObject({
            type: 'load',
            id: 1,
        });
        worker.emit({ id: 2, type: 'progress', percent: 20 });
        worker.emit({ id: 1, type: 'progress', percent: Infinity });
        worker.emit({ id: 1, type: 'progress', percent: 120 });
        worker.emit({ id: 1, type: 'progress', percent: 30 });
        worker.emit({ id: 1, type: 'progress', percent: null });
        expect(progress.mock.calls).toEqual([[30], [null]]);
        worker.emit({ id: 1, type: 'ready' });
        await pending;
        await client.load(progress);
        expect(worker.postMessage).toHaveBeenCalledTimes(1);
    });

    it('bounds audio and permits only a single operation', async () => {
        await expect(client.transcribe(new Float32Array(100))).rejects.toThrow(
            'not loaded'
        );
        await load();
        for (const audio of [
            new Float32Array(),
            new Float32Array(80_001),
            new Float32Array([NaN]),
            new Float32Array([2]),
        ]) {
            await expect(client.transcribe(audio)).rejects.toThrow('Invalid');
        }
        const audio = new Float32Array([0.1, 0.2]);
        const result = client.transcribe(audio);
        const sent = worker.postMessage.mock.calls[1][0];
        expect(sent.type).toBe('transcribe');
        if (sent.type === 'transcribe') {
            expect(sent.samples).toEqual(audio);
            expect(sent.samples).not.toBe(audio);
        }
        await expect(client.transcribe(audio)).rejects.toThrow('busy');
        worker.emit({ id: 2, type: 'ready' });
        worker.emit({ id: 2, type: 'result', text: 'Hello.' });
        await expect(result).resolves.toBe('Hello.');
    });

    it.each(['dispose', 'error', 'messageerror', 'timeout'] as const)(
        'terminates and rejects model loading on %s',
        async (reason) => {
            const promise = client.load(() => undefined);
            const rejected = expect(promise).rejects.toThrow();
            if (reason === 'dispose') client.dispose();
            if (reason === 'error') worker.fail();
            if (reason === 'messageerror')
                worker.onmessageerror?.call(
                    worker as unknown as Worker,
                    {} as MessageEvent
                );
            if (reason === 'timeout') jest.advanceTimersByTime(180_000);
            await rejected;
            expect(worker.terminate).toHaveBeenCalledTimes(1);
        }
    );

    it('terminates inference after its deadline and rejects raw remote errors', async () => {
        await load();
        const result = client.transcribe(new Float32Array(16000));
        const rejected = expect(result).rejects.toThrow('timed out');
        jest.advanceTimersByTime(30_000);
        await rejected;
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        await expect(client.transcribe(new Float32Array(1))).rejects.toThrow(
            'not loaded'
        );
    });

    it('reports fixed safe errors and can retry after failure', async () => {
        const pending = client.load(() => undefined);
        const rejected = expect(pending).rejects.toThrow(
            'could not be downloaded'
        );
        worker.emit({
            id: 1,
            type: 'error',
            code: 'load',
            detail: 'private remote URL',
        });
        await rejected;
        const retry = client.load(() => undefined);
        worker.emit({ id: 2, type: 'ready' });
        await retry;
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it('rejects synchronous worker send errors without leaving a pending timeout', async () => {
        worker.postMessage.mockImplementation(() => {
            throw new Error('remote details');
        });
        await expect(client.load(() => undefined)).rejects.toThrow(
            'could not start'
        );
        expect(jest.getTimerCount()).toBe(0);
    });

    it('cannot recreate a disposed client', async () => {
        client.dispose();
        await expect(client.load(() => undefined)).rejects.toThrow('stopped');
        expect(factory).not.toHaveBeenCalled();
    });
});
