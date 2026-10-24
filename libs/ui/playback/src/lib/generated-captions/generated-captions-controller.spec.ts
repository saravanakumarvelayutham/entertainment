import { GeneratedCaptionsController } from './generated-captions-controller';
import type { PlayerAudioCapture } from './player-audio-capture';
import type { CaptionWorkerClient } from './caption-worker-client';

describe('GeneratedCaptionsController', () => {
    let video: HTMLVideoElement;
    let surface: HTMLElement;
    let audio: (samples: Float32Array, endTime: number) => void;
    let captureError: (error: Error) => void;
    const capture = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
    const worker = {
        load: jest.fn(),
        transcribe: jest.fn(),
        dispose: jest.fn(),
    };
    const onStart = jest.fn();
    let controller: GeneratedCaptionsController;
    const originalWorker = globalThis.Worker;
    const originalContext = globalThis.AudioContext;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        globalThis.Worker = jest.fn() as unknown as typeof Worker;
        globalThis.AudioContext = jest.fn() as unknown as typeof AudioContext;
        video = document.createElement('video');
        Object.defineProperties(video, {
            captureStream: { value: jest.fn() },
            paused: { value: false, configurable: true },
            seeking: { value: false, configurable: true },
            currentTime: { value: 10, configurable: true },
        });
        surface = document.createElement('div');
        surface.append(video);
        capture.start.mockImplementation(async (_video, onAudio, onError) => {
            audio = onAudio;
            captureError = onError;
        });
        worker.load.mockResolvedValue(undefined);
        worker.transcribe.mockResolvedValue('Hello from this video.');
        controller = new GeneratedCaptionsController({
            createCapture: () => capture as unknown as PlayerAudioCapture,
            createWorker: () => worker as unknown as CaptionWorkerClient,
            onStart,
        });
        controller.bind(surface);
    });
    afterEach(() => {
        controller.destroy();
        jest.useRealTimers();
        globalThis.Worker = originalWorker;
        globalThis.AudioContext = originalContext;
    });
    const settle = async () => {
        await Promise.resolve();
        await Promise.resolve();
    };

    it('does no capture or download before the user enables captions', () => {
        expect(controller.available()).toBe(true);
        expect(controller.status()).toBe('off');
        expect(capture.start).not.toHaveBeenCalled();
        expect(worker.load).not.toHaveBeenCalled();
    });

    it('loads once and renders bounded captions from the bound player audio', async () => {
        await controller.start();
        expect(capture.start).toHaveBeenCalledWith(
            video,
            expect.any(Function),
            expect.any(Function)
        );
        expect(worker.load).toHaveBeenCalledTimes(1);
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(controller.status()).toBe('listening');
        await controller.start();
        audio(new Float32Array(80_000), 10);
        await settle();
        expect(controller.caption()).toBe('Hello from this video.');
        jest.advanceTimersByTime(6000);
        expect(controller.caption()).toBe('');
        controller.stop();
        expect(capture.stop).toHaveBeenCalled();
        expect(worker.dispose).toHaveBeenCalled();
    });

    it.each(['pause', 'seeking', 'waiting', 'ratechange'])(
        'discards an in-flight line and resets audio on %s',
        async (event) => {
            let resolve!: (value: string) => void;
            worker.transcribe.mockImplementationOnce(
                () =>
                    new Promise((done) => {
                        resolve = done;
                    })
            );
            await controller.start();
            audio(new Float32Array(80_000), 10);
            video.dispatchEvent(new Event(event));
            resolve('Stale dialogue');
            await settle();
            expect(controller.caption()).toBe('');
            expect(capture.reset).toHaveBeenCalled();
        }
    );

    it.each(['loadstart', 'emptied', 'ended'])(
        'releases capture and inference on %s',
        async (event) => {
            await controller.start();
            video.dispatchEvent(new Event(event));
            expect(controller.status()).toBe('off');
            expect(controller.caption()).toBe('');
            expect(worker.dispose).toHaveBeenCalled();
        }
    );

    it('does not accumulate queued chunks while recognition is busy', async () => {
        let resolve!: (value: string) => void;
        worker.transcribe.mockImplementationOnce(
            () =>
                new Promise((done) => {
                    resolve = done;
                })
        );
        await controller.start();
        audio(new Float32Array(80_000), 10);
        audio(new Float32Array(80_000), 15);
        expect(worker.transcribe).toHaveBeenCalledTimes(1);
        resolve('One line');
        await settle();
        audio(new Float32Array(80_000), 10);
        await settle();
        expect(worker.transcribe).toHaveBeenCalledTimes(2);
    });

    it('ignores late model loading and captions after Stop', async () => {
        let finish!: () => void;
        worker.load.mockImplementationOnce(
            () =>
                new Promise<void>((done) => {
                    finish = done;
                })
        );
        const starting = controller.start();
        await settle();
        controller.stop();
        finish();
        await starting;
        expect(controller.status()).toBe('off');
        expect(onStart).not.toHaveBeenCalled();
    });

    it('reports capture, download, and inference failures with retry available', async () => {
        capture.start.mockRejectedValueOnce(new Error('Unavailable'));
        await controller.start();
        expect(controller.failurePhase()).toBe('audio');
        expect(worker.load).not.toHaveBeenCalled();
        worker.load.mockRejectedValueOnce(new Error('Offline'));
        await controller.start();
        expect(controller.failurePhase()).toBe('model');
        await controller.start();
        worker.transcribe.mockRejectedValueOnce(new Error('Runtime failed'));
        audio(new Float32Array(80_000), 10);
        await settle();
        expect(controller.failurePhase()).toBe('inference');
        expect(controller.panelOpen()).toBe(true);
        expect(controller.status()).toBe('error');
    });

    it('stops on capture errors and media element replacement', async () => {
        await controller.start();
        captureError(new Error('Capture ended'));
        expect(controller.failurePhase()).toBe('audio');
        await controller.start();
        video.replaceWith(document.createElement('canvas'));
        await settle();
        expect(controller.available()).toBe(false);
        expect(controller.status()).toBe('off');
    });

    it('does not display stale or empty recognition', async () => {
        await controller.start();
        audio(new Float32Array(80_000), -20);
        await settle();
        expect(controller.caption()).toBe('');
        worker.transcribe.mockResolvedValueOnce('   ');
        audio(new Float32Array(80_000), 10);
        await settle();
        expect(controller.caption()).toBe('');
    });
});
