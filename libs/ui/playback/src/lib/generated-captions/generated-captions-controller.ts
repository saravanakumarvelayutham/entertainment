import { computed, signal } from '@angular/core';
import { PlayerAudioCapture } from './player-audio-capture';
import { CaptionWorkerClient } from './caption-worker-client';

type CaptionStatus = 'off' | 'loading' | 'listening' | 'error';
type FailurePhase = 'audio' | 'model' | 'inference';

interface CaptionControllerOptions {
    createCapture?: () => PlayerAudioCapture;
    createWorker?: () => CaptionWorkerClient;
    onStart?: () => void;
}

/** Owns one opt-in transcription session bound to the current player video. */
export class GeneratedCaptionsController {
    readonly available = signal(false);
    readonly panelOpen = signal(false);
    readonly status = signal<CaptionStatus>('off');
    readonly progress = signal<number | null>(null);
    readonly caption = signal('');
    readonly failurePhase = signal<FailurePhase | null>(null);
    readonly enabled = computed(() =>
        ['loading', 'listening'].includes(this.status())
    );
    private surface: HTMLElement | null = null;
    private video: HTMLVideoElement | null = null;
    private observer: MutationObserver | null = null;
    private capture: PlayerAudioCapture | null = null;
    private worker: CaptionWorkerClient | null = null;
    private generation = 0;
    private timeline = 0;
    private busy = false;
    private clearTimer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;
    private readonly resetTimeline = () => {
        this.timeline++;
        this.capture?.reset();
        this.clearCaption();
    };
    private readonly stopForSource = () => this.stop();

    constructor(private readonly options: CaptionControllerOptions = {}) {}

    bind(surface: HTMLElement | null): void {
        if (this.destroyed || surface === this.surface) return;
        this.observer?.disconnect();
        this.observer = null;
        this.surface = surface;
        this.findVideo();
        if (surface) {
            this.observer = new MutationObserver(() => this.findVideo());
            this.observer.observe(surface, { childList: true, subtree: true });
        }
    }

    async start(): Promise<void> {
        const video = this.video;
        if (this.destroyed || !this.available() || !video || this.enabled())
            return;
        this.stop();
        const generation = this.generation;
        this.status.set('loading');
        this.failurePhase.set(null);
        const capture =
            this.options.createCapture?.() ?? new PlayerAudioCapture();
        const worker =
            this.options.createWorker?.() ?? new CaptionWorkerClient();
        this.capture = capture;
        this.worker = worker;
        let phase: FailurePhase = 'audio';
        try {
            await capture.start(
                video,
                (samples, endTime) =>
                    void this.transcribe(generation, samples, endTime),
                () => {
                    if (this.isCurrent(generation)) this.fail('audio');
                }
            );
            if (!this.isCurrent(generation)) return;
            phase = 'model';
            await worker.load((percent) => {
                if (this.isCurrent(generation)) this.progress.set(percent);
            });
            if (!this.isCurrent(generation)) return;
            capture.reset();
            this.panelOpen.set(false);
            this.options.onStart?.();
            this.status.set('listening');
        } catch {
            if (this.isCurrent(generation)) this.fail(phase);
        }
    }

    stop(): void {
        this.generation++;
        this.timeline++;
        this.capture?.stop();
        this.worker?.dispose();
        this.capture = null;
        this.worker = null;
        this.busy = false;
        this.progress.set(null);
        this.status.set('off');
        this.failurePhase.set(null);
        this.clearCaption();
    }

    destroy(): void {
        this.bind(null);
        this.stop();
        this.panelOpen.set(false);
        this.destroyed = true;
    }

    private findVideo(): void {
        const video = this.surface?.querySelector('video') ?? null;
        if (video === this.video) return;
        this.stop();
        this.mediaEvents(this.video, false);
        this.video = video;
        this.mediaEvents(video, true);
        this.available.set(
            Boolean(
                video &&
                typeof (video as HTMLVideoElement & { captureStream?: unknown })
                    .captureStream === 'function' &&
                typeof AudioContext !== 'undefined' &&
                typeof Worker !== 'undefined'
            )
        );
    }

    private mediaEvents(video: HTMLVideoElement | null, attach: boolean): void {
        if (!video) return;
        const method = attach ? 'addEventListener' : 'removeEventListener';
        for (const event of ['pause', 'seeking', 'waiting', 'ratechange']) {
            video[method](event, this.resetTimeline);
        }
        for (const event of ['loadstart', 'emptied', 'ended']) {
            video[method](event, this.stopForSource);
        }
    }

    private async transcribe(
        generation: number,
        samples: Float32Array,
        endTime: number
    ): Promise<void> {
        const worker = this.worker;
        if (
            !this.isCurrent(generation) ||
            this.status() !== 'listening' ||
            this.busy ||
            !worker
        )
            return;
        this.busy = true;
        const timeline = this.timeline;
        try {
            const text = (await worker.transcribe(samples))
                .trim()
                .slice(0, 600);
            if (
                !this.isCurrent(generation) ||
                this.timeline !== timeline ||
                !text
            )
                return;
            const video = this.video;
            // Slow inference must never put an old line over a later scene.
            if (
                !video ||
                video.paused ||
                video.seeking ||
                Math.abs(video.currentTime - endTime) > 15
            )
                return;
            this.clearCaption();
            this.caption.set(text);
            this.clearTimer = setTimeout(() => this.caption.set(''), 6000);
        } catch {
            if (this.isCurrent(generation)) this.fail('inference');
        } finally {
            if (this.isCurrent(generation)) this.busy = false;
        }
    }

    private isCurrent(generation: number): boolean {
        return !this.destroyed && this.generation === generation;
    }

    private fail(phase: FailurePhase): void {
        this.stop();
        this.failurePhase.set(phase);
        this.status.set('error');
        this.panelOpen.set(true);
    }

    private clearCaption(): void {
        if (this.clearTimer !== null) clearTimeout(this.clearTimer);
        this.clearTimer = null;
        this.caption.set('');
    }
}
