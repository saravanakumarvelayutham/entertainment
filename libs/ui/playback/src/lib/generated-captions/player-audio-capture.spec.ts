import { PlayerAudioCapture } from './player-audio-capture';

describe('PlayerAudioCapture', () => {
    let capture: PlayerAudioCapture;
    let processor: {
        connect: jest.Mock;
        disconnect: jest.Mock;
        onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
    };
    let context: {
        sampleRate: number;
        createMediaStreamSource: jest.Mock;
        createScriptProcessor: jest.Mock;
        createGain: jest.Mock;
        resume: jest.Mock;
        close: jest.Mock;
        destination: object;
    };
    let source: { connect: jest.Mock; disconnect: jest.Mock };
    let silentOutput: {
        connect: jest.Mock;
        disconnect: jest.Mock;
        gain: { value: number };
    };
    let track: { stop: jest.Mock };
    let stream: { getAudioTracks: jest.Mock; getTracks: jest.Mock };
    let video: {
        captureStream: jest.Mock;
        paused: boolean;
        seeking: boolean;
        currentTime: number;
        pause: jest.Mock;
        volume: number;
        muted: boolean;
    };
    let onAudio: jest.Mock;
    let onError: jest.Mock;
    const originalContext = globalThis.AudioContext;

    beforeEach(() => {
        capture = new PlayerAudioCapture();
        source = { connect: jest.fn(), disconnect: jest.fn() };
        processor = {
            connect: jest.fn(),
            disconnect: jest.fn(),
            onaudioprocess: null,
        };
        silentOutput = {
            connect: jest.fn(),
            disconnect: jest.fn(),
            gain: { value: 1 },
        };
        track = { stop: jest.fn() };
        stream = {
            getAudioTracks: jest.fn(() => [track]),
            getTracks: jest.fn(() => [track]),
        };
        video = {
            captureStream: jest.fn(() => stream),
            paused: false,
            seeking: false,
            currentTime: 20,
            pause: jest.fn(),
            volume: 0.7,
            muted: false,
        };
        context = {
            sampleRate: 16_000,
            destination: {},
            createMediaStreamSource: jest.fn(() => source),
            createScriptProcessor: jest.fn(() => processor),
            createGain: jest.fn(() => silentOutput),
            resume: jest.fn(() => Promise.resolve()),
            close: jest.fn(() => Promise.resolve()),
        };
        globalThis.AudioContext = jest.fn(
            () => context
        ) as unknown as typeof AudioContext;
        onAudio = jest.fn();
        onError = jest.fn();
    });

    afterEach(() => {
        capture.stop();
        globalThis.AudioContext = originalContext;
    });

    async function start(): Promise<void> {
        await capture.start(
            video as unknown as HTMLVideoElement,
            onAudio,
            onError
        );
    }

    function feed(length: number, ...values: number[]): void {
        const channels = values.map((value) =>
            new Float32Array(length).fill(value)
        );
        processor.onaudioprocess?.({
            inputBuffer: {
                numberOfChannels: channels.length,
                length,
                getChannelData: (index: number) => channels[index],
            },
        } as unknown as AudioProcessingEvent);
    }

    it('captures only the video stream and leaves playback controls untouched', async () => {
        await start();
        expect(video.captureStream).toHaveBeenCalledTimes(1);
        expect(globalThis.AudioContext).toHaveBeenCalledWith({
            sampleRate: 16_000,
        });
        expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream);
        expect(silentOutput.gain.value).toBe(0);
        capture.stop();
        expect(video.pause).not.toHaveBeenCalled();
        expect(video.volume).toBe(0.7);
        expect(video.muted).toBe(false);
    });

    it('downmixes stereo into exact five-second chunks and retains the remainder', async () => {
        await start();
        feed(79_000, 0.2, 0.6);
        expect(onAudio).not.toHaveBeenCalled();
        feed(2_000, 0.2, 0.6);
        expect(onAudio).toHaveBeenCalledTimes(1);
        const [samples, end] = onAudio.mock.calls[0];
        expect(samples).toHaveLength(80_000);
        expect(samples[0]).toBeCloseTo(0.4);
        expect(samples[79_999]).toBeCloseTo(0.4);
        expect(end).toBeCloseTo(19.9375);
        feed(79_000, 0.8);
        expect(onAudio).toHaveBeenCalledTimes(2);
        expect(onAudio.mock.calls[0][0][0]).toBeCloseTo(0.4);
        expect(onAudio.mock.calls[1][0][1_000]).toBeCloseTo(0.8);
    });

    it('drops near-silence without retaining it in the next chunk', async () => {
        await start();
        feed(80_000, 0.00001);
        expect(onAudio).not.toHaveBeenCalled();
        feed(80_000, 0.5);
        expect(onAudio).toHaveBeenCalledTimes(1);
        expect(onAudio.mock.calls[0][0][0]).toBe(0.5);
    });

    it.each(['paused', 'seeking'] as const)(
        'discards buffered audio while %s',
        async (state) => {
            await start();
            feed(40_000, 0.5);
            video[state] = true;
            feed(40_000, 0.5);
            video[state] = false;
            feed(40_000, 0.5);
            expect(onAudio).not.toHaveBeenCalled();
            feed(40_000, 0.5);
            expect(onAudio).toHaveBeenCalledTimes(1);
        }
    );

    it('reset discards partial audio on a playback discontinuity', async () => {
        await start();
        feed(40_000, 0.5);
        capture.reset();
        feed(40_000, 0.5);
        expect(onAudio).not.toHaveBeenCalled();
    });

    it('disconnects every node, closes the context and stops captured tracks', async () => {
        await start();
        const staleCallback = processor.onaudioprocess;
        capture.stop();
        capture.stop();
        expect(source.disconnect).toHaveBeenCalledTimes(1);
        expect(processor.disconnect).toHaveBeenCalledTimes(1);
        expect(silentOutput.disconnect).toHaveBeenCalledTimes(1);
        expect(context.close).toHaveBeenCalledTimes(1);
        expect(track.stop).toHaveBeenCalledTimes(1);
        expect(processor.onaudioprocess).toBeNull();
        staleCallback?.({} as AudioProcessingEvent);
        expect(onError).not.toHaveBeenCalled();
    });

    it('rejects unavailable audio and cleans up the captured stream', async () => {
        stream.getAudioTracks.mockReturnValue([]);
        await expect(start()).rejects.toThrow('Start video playback');
        expect(track.stop).toHaveBeenCalledTimes(1);
        expect(context.createMediaStreamSource).not.toHaveBeenCalled();
    });

    it('rejects unsupported player capture without requesting another audio source', async () => {
        await expect(
            capture.start({} as HTMLVideoElement, onAudio, onError)
        ).rejects.toThrow('does not support audio capture');
        expect(globalThis.AudioContext).not.toHaveBeenCalled();
    });

    it('rejects an unsupported sample rate rather than producing mistimed captions', async () => {
        context.sampleRate = 48_000;
        await expect(start()).rejects.toThrow('16 kHz');
        expect(track.stop).toHaveBeenCalled();
        expect(context.close).toHaveBeenCalled();
    });

    it('does not reactivate after stop races with context resume', async () => {
        let resume!: () => void;
        context.resume.mockReturnValue(
            new Promise<void>((resolve) => {
                resume = resolve;
            })
        );
        const pending = start();
        await Promise.resolve();
        await Promise.resolve();
        capture.stop();
        resume();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(processor.onaudioprocess).toBeNull();
        expect(context.close).toHaveBeenCalledTimes(1);
    });

    it('stops tracks if capture resolves after the session was stopped', async () => {
        const pending = start();
        capture.stop();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(track.stop).toHaveBeenCalledTimes(1);
        expect(globalThis.AudioContext).not.toHaveBeenCalled();
    });

    it('reports processing failures and closes capture', async () => {
        await start();
        onAudio.mockImplementation(() => {
            throw new Error('Caption worker unavailable');
        });
        feed(80_000, 0.5);
        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Caption worker unavailable' })
        );
        expect(context.close).toHaveBeenCalledTimes(1);
    });
});
