import { jest } from '@jest/globals';

const transcribe = jest.fn<(...args: unknown[]) => Promise<{ text: string }>>();
const pipeline = jest.fn<(...args: unknown[]) => Promise<typeof transcribe>>();
const env = {
    allowLocalModels: true,
    useBrowserCache: false,
    backends: { onnx: { wasm: { numThreads: 4, proxy: true, wasmPaths: {} } } },
};

jest.unstable_mockModule('@huggingface/transformers', () => ({
    env,
    pipeline,
}));

describe('caption inference worker', () => {
    let receive: (event: MessageEvent) => void;
    let post: ReturnType<typeof jest.spyOn<typeof globalThis, 'postMessage'>>;

    beforeAll(async () => {
        const listen = jest
            .spyOn(self, 'addEventListener')
            .mockImplementation((type, callback) => {
                if (type === 'message')
                    receive = callback as (event: MessageEvent) => void;
            });
        post = jest
            .spyOn(self, 'postMessage')
            .mockImplementation(() => undefined);
        await import('./caption-inference.worker');
        listen.mockRestore();
    });
    beforeEach(() => {
        post.mockClear();
        pipeline.mockResolvedValue(transcribe);
        transcribe.mockResolvedValue({ text: ' Hello world. ' });
    });
    afterAll(() => post.mockRestore());

    async function send(data: unknown): Promise<void> {
        receive({ data } as MessageEvent);
        // Pipeline load and its request handler each settle a microtask.
        for (let i = 0; i < 8; i++) await Promise.resolve();
    }

    it('rejects inference before load and malformed audio without touching the model', async () => {
        expect(pipeline).not.toHaveBeenCalled();
        await send({
            id: 1,
            type: 'transcribe',
            samples: new Float32Array(100),
        });
        expect(post).toHaveBeenLastCalledWith({
            id: 1,
            type: 'error',
            code: 'inference',
        });
        await send({
            id: 2,
            type: 'transcribe',
            samples: new Float32Array([NaN]),
        });
        expect(post).toHaveBeenLastCalledWith({
            id: 2,
            type: 'error',
            code: 'invalid',
        });
        expect(pipeline).not.toHaveBeenCalled();
    });

    it('rejects remotely supplied runtime code', async () => {
        await send({
            id: 3,
            type: 'load',
            runtimeBase: 'https://outside.example/assets/caption-runtime/',
        });
        expect(post).toHaveBeenLastCalledWith({
            id: 3,
            type: 'error',
            code: 'load',
        });
        expect(pipeline).not.toHaveBeenCalled();
    });

    it('loads pinned local inference with app runtime assets and bounds progress', async () => {
        pipeline.mockImplementation(async (...args) => {
            const options = args[2] as {
                progress_callback: (value: unknown) => void;
            };
            options.progress_callback({ progress: 120 });
            options.progress_callback({ progress: NaN });
            return transcribe;
        });
        await send({
            id: 4,
            type: 'load',
            runtimeBase: new URL('assets/caption-runtime/', document.baseURI)
                .href,
        });
        expect(pipeline).toHaveBeenCalledWith(
            'automatic-speech-recognition',
            'Xenova/whisper-tiny.en',
            expect.objectContaining({
                revision: '79fb389fc764e7c395bd330e9531d9d32ada7049',
                device: 'wasm',
                dtype: 'q8',
            })
        );
        expect(env.allowLocalModels).toBe(false);
        expect(env.backends.onnx.wasm).toMatchObject({
            numThreads: 1,
            proxy: false,
        });
        expect(env.backends.onnx.wasm.wasmPaths).toEqual({
            mjs: new URL(
                'assets/caption-runtime/ort-wasm-simd-threaded.asyncify.mjs',
                document.baseURI
            ).href,
            wasm: new URL(
                'assets/caption-runtime/ort-wasm-simd-threaded.asyncify.wasm',
                document.baseURI
            ).href,
        });
        expect(post).toHaveBeenCalledWith({
            id: 4,
            type: 'progress',
            percent: 100,
        });
        expect(post).toHaveBeenCalledWith({
            id: 4,
            type: 'progress',
            percent: null,
        });
        expect(post).toHaveBeenLastCalledWith({ id: 4, type: 'ready' });
    });

    it('bounds decoding and returns text without remote transport', async () => {
        const samples = new Float32Array(80_000);
        await send({ id: 5, type: 'transcribe', samples });
        expect(transcribe).toHaveBeenCalledWith(samples, {
            max_new_tokens: 64,
            return_timestamps: false,
            do_sample: false,
        });
        expect(post).toHaveBeenLastCalledWith({
            id: 5,
            type: 'result',
            text: 'Hello world.',
        });
    });

    it('rejects overlapping inference and hides library error details', async () => {
        let fail!: (error: Error) => void;
        transcribe.mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    fail = reject;
                })
        );
        await send({
            id: 6,
            type: 'transcribe',
            samples: new Float32Array(100),
        });
        await send({
            id: 7,
            type: 'transcribe',
            samples: new Float32Array(100),
        });
        expect(post).toHaveBeenLastCalledWith({
            id: 7,
            type: 'error',
            code: 'busy',
        });
        fail(new Error('Sensitive remote URL'));
        for (let i = 0; i < 8; i++) await Promise.resolve();
        expect(post).toHaveBeenLastCalledWith({
            id: 6,
            type: 'error',
            code: 'inference',
        });
    });
});
