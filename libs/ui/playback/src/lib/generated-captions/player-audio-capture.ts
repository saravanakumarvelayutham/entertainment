import { capturePlayerAudio } from './player-audio-stream';

const SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = SAMPLE_RATE * 5;
const MIN_RMS = 0.001;

interface CaptureSession {
    stream: MediaStream;
    context?: AudioContext;
    source?: MediaStreamAudioSourceNode;
    processor?: ScriptProcessorNode;
    silentOutput?: GainNode;
    samples: Float32Array;
    length: number;
    squareSum: number;
}

/** Captures the player/app audio; never requests microphone or system audio. */
export class PlayerAudioCapture {
    private session?: CaptureSession;
    private generation = 0;

    async start(
        video: HTMLVideoElement,
        onAudio: (samples: Float32Array, endTimeSeconds: number) => void,
        onError: (error: Error) => void
    ): Promise<void> {
        this.stop();
        const generation = this.generation;
        const stream = await capturePlayerAudio(video);
        if (this.generation !== generation) {
            for (const track of stream.getTracks()) track.stop();
            throw new DOMException(
                'Player audio capture was stopped.',
                'AbortError'
            );
        }
        const session: CaptureSession = {
            stream,
            samples: new Float32Array(CHUNK_SAMPLES),
            length: 0,
            squareSum: 0,
        };
        this.session = session;
        try {
            if (!session.stream.getAudioTracks().length) {
                throw new Error(
                    'Start video playback before enabling generated captions. No player audio is available yet.'
                );
            }
            const context = new AudioContext({ sampleRate: SAMPLE_RATE });
            session.context = context;
            if (context.sampleRate !== SAMPLE_RATE) {
                throw new Error(
                    'This audio device does not support 16 kHz caption capture.'
                );
            }
            session.source = context.createMediaStreamSource(session.stream);
            session.processor = context.createScriptProcessor(4096, 2, 1);
            session.silentOutput = context.createGain();
            // Keep processing alive without replaying the captured audio over the video.
            session.silentOutput.gain.value = 0;
            session.source.connect(session.processor);
            session.processor.connect(session.silentOutput);
            session.silentOutput.connect(context.destination);
            session.processor.onaudioprocess = (event) => {
                if (this.session !== session) return;
                if (video.paused || video.seeking) {
                    this.reset();
                    return;
                }
                try {
                    this.collect(
                        session,
                        event.inputBuffer,
                        video.currentTime,
                        onAudio
                    );
                } catch (error) {
                    this.stop();
                    onError(
                        error instanceof Error
                            ? error
                            : new Error('Player audio capture failed.')
                    );
                }
            };
            await context.resume();
            if (this.session !== session) {
                throw new DOMException(
                    'Player audio capture was stopped.',
                    'AbortError'
                );
            }
        } catch (error) {
            if (this.session === session) this.stop();
            throw error;
        }
    }

    reset(): void {
        if (!this.session) return;
        this.session.length = 0;
        this.session.squareSum = 0;
    }

    stop(): void {
        this.generation++;
        const session = this.session;
        this.session = undefined;
        if (!session) return;
        if (session.processor) session.processor.onaudioprocess = null;
        session.source?.disconnect();
        session.processor?.disconnect();
        session.silentOutput?.disconnect();
        for (const track of session.stream.getTracks()) track.stop();
        if (session.context)
            void session.context.close().catch(() => undefined);
    }

    private collect(
        session: CaptureSession,
        input: AudioBuffer,
        endTime: number,
        onAudio: (samples: Float32Array, endTimeSeconds: number) => void
    ): void {
        if (!input.numberOfChannels) return;
        const channels = Array.from(
            { length: input.numberOfChannels },
            (_, index) => input.getChannelData(index)
        );
        for (let index = 0; index < input.length; index++) {
            let sample = 0;
            for (const channel of channels) sample += channel[index];
            sample /= channels.length;
            session.samples[session.length++] = sample;
            session.squareSum += sample * sample;
            if (session.length !== CHUNK_SAMPLES) continue;
            const audible =
                Math.sqrt(session.squareSum / CHUNK_SAMPLES) >= MIN_RMS;
            const samples = session.samples;
            session.length = 0;
            session.squareSum = 0;
            if (audible) {
                session.samples = new Float32Array(CHUNK_SAMPLES);
                onAudio(
                    samples,
                    endTime - (input.length - index - 1) / SAMPLE_RATE
                );
                if (this.session !== session) return;
            }
        }
    }
}
