import {
    isCaptionSamples,
    isCaptionWorkerResponse,
    type CaptionWorkerRequest,
} from './caption-worker-protocol';
import { createCaptionWorker } from './caption-worker-factory';

export type CaptionWorker = Pick<
    Worker,
    'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;
type PendingRequest = {
    id: number;
    type: 'load' | 'transcribe';
    resolve: (text: string) => void;
    reject: (reason: Error) => void;
    progress?: (percent: number | null) => void;
    timer: ReturnType<typeof setTimeout>;
};

export class CaptionWorkerClient {
    private worker?: CaptionWorker;
    private pending?: PendingRequest;
    private nextId = 0;
    private loaded = false;
    private disposed = false;

    constructor(
        private readonly workerFactory: () => CaptionWorker = createCaptionWorker
    ) {}

    async load(onProgress: (percent: number | null) => void): Promise<void> {
        this.assertIdle();
        if (this.loaded) return;
        if (!this.worker) {
            this.worker = this.workerFactory();
            this.worker.onmessage = (event) => this.onMessage(event.data);
            this.worker.onerror = () =>
                this.stop(new Error('Caption worker failed.'));
            this.worker.onmessageerror = () =>
                this.stop(new Error('Caption worker response failed.'));
        }
        await this.request(
            {
                id: ++this.nextId,
                type: 'load',
                runtimeBase: new URL(
                    'assets/caption-runtime/',
                    document.baseURI
                ).href,
            },
            180_000,
            onProgress
        );
        this.loaded = true;
    }

    async transcribe(samples: Float32Array): Promise<string> {
        this.assertIdle();
        if (!this.loaded) throw new Error('Caption model is not loaded.');
        if (!isCaptionSamples(samples))
            throw new Error('Invalid caption audio.');
        // Transfer a copy so caller-owned buffers remain available for lifecycle cleanup.
        return this.request(
            { id: ++this.nextId, type: 'transcribe', samples: samples.slice() },
            30_000
        );
    }

    dispose(): void {
        this.disposed = true;
        this.stop(new Error('Captions stopped.'));
    }

    private assertIdle(): void {
        if (this.disposed) throw new Error('Captions stopped.');
        if (this.pending) throw new Error('Caption worker is busy.');
    }

    private request(
        message: CaptionWorkerRequest,
        timeout: number,
        progress?: (percent: number | null) => void
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => this.stop(new Error('Caption processing timed out.')),
                timeout
            );
            this.pending = {
                id: message.id,
                type: message.type,
                resolve,
                reject,
                progress,
                timer,
            };
            try {
                if (message.type === 'transcribe')
                    this.worker?.postMessage(message, [message.samples.buffer]);
                else this.worker?.postMessage(message);
            } catch {
                this.stop(new Error('Caption worker could not start.'));
            }
        });
    }

    private onMessage(data: unknown): void {
        const pending = this.pending;
        if (
            !pending ||
            !isCaptionWorkerResponse(data) ||
            data.id !== pending.id
        )
            return;
        if (data.type === 'progress') {
            if (pending.type === 'load') pending.progress?.(data.percent);
            return;
        }
        if (data.type === 'error') {
            this.stop(
                new Error(
                    pending.type === 'load'
                        ? 'Caption model could not be downloaded or loaded.'
                        : 'Caption audio could not be transcribed.'
                )
            );
            return;
        }
        if (
            (pending.type === 'load' && data.type !== 'ready') ||
            (pending.type === 'transcribe' && data.type !== 'result')
        )
            return;
        clearTimeout(pending.timer);
        this.pending = undefined;
        pending.resolve(data.type === 'result' ? data.text : '');
    }

    private stop(error: Error): void {
        const pending = this.pending;
        this.pending = undefined;
        this.loaded = false;
        if (this.worker) {
            this.worker.onmessage = null;
            this.worker.onerror = null;
            this.worker.onmessageerror = null;
            this.worker.terminate();
            this.worker = undefined;
        }
        if (pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
    }
}
