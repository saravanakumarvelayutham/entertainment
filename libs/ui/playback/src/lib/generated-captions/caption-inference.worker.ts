/// <reference lib="webworker" />
import {
    env,
    pipeline,
    type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';
import {
    CAPTION_MAX_TEXT_LENGTH,
    isCaptionRequestId,
    isCaptionSamples,
    type CaptionWorkerResponse,
} from './caption-worker-protocol';

// Pin both weights and configuration; model changes must be reviewed together.
const MODEL_REVISION = '79fb389fc764e7c395bd330e9531d9d32ada7049';
let transcriber: AutomaticSpeechRecognitionPipeline | undefined;
let busy = false;

function reply(message: CaptionWorkerResponse): void {
    self.postMessage(message);
}

async function load(id: number, runtimeBase: string): Promise<void> {
    const runtime = new URL(runtimeBase);
    // Runtime code comes from this app, never from a model response or a CDN.
    if (
        runtime.protocol !== self.location.protocol ||
        runtime.host !== self.location.host ||
        !runtime.pathname.endsWith('/assets/caption-runtime/')
    ) {
        throw new Error('Invalid runtime');
    }
    env.allowLocalModels = false;
    env.useBrowserCache = typeof caches !== 'undefined';
    const wasm = env.backends.onnx.wasm;
    if (!wasm) throw new Error('WASM backend unavailable');
    wasm.numThreads = 1;
    wasm.proxy = false;
    wasm.wasmPaths = {
        mjs: new URL('ort-wasm-simd-threaded.asyncify.mjs', runtime).href,
        wasm: new URL('ort-wasm-simd-threaded.asyncify.wasm', runtime).href,
    };
    transcriber ??= await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny.en',
        {
            revision: MODEL_REVISION,
            device: 'wasm',
            dtype: 'q8',
            progress_callback: (progress) => {
                const percent =
                    'progress' in progress &&
                    typeof progress.progress === 'number' &&
                    Number.isFinite(progress.progress)
                        ? Math.max(0, Math.min(100, progress.progress))
                        : null;
                reply({ id, type: 'progress', percent });
            },
        }
    );
    reply({ id, type: 'ready' });
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || !isCaptionRequestId(data['id']))
        return;
    const id = data['id'];
    const loading =
        data['type'] === 'load' && typeof data['runtimeBase'] === 'string';
    const inferring =
        data['type'] === 'transcribe' && isCaptionSamples(data['samples']);
    if (!loading && !inferring) {
        reply({ id, type: 'error', code: 'invalid' });
        return;
    }
    if (busy) {
        reply({ id, type: 'error', code: 'busy' });
        return;
    }
    busy = true;
    void (async () => {
        try {
            if (loading) {
                await load(id, data['runtimeBase'] as string);
            } else {
                if (!transcriber) throw new Error('Model not loaded');
                const output = await transcriber(
                    data['samples'] as Float32Array,
                    {
                        max_new_tokens: 64,
                        return_timestamps: false,
                        do_sample: false,
                    }
                );
                reply({
                    id,
                    type: 'result',
                    text: output.text.trim().slice(0, CAPTION_MAX_TEXT_LENGTH),
                });
            }
        } catch {
            reply({ id, type: 'error', code: loading ? 'load' : 'inference' });
        } finally {
            busy = false;
        }
    })();
});
