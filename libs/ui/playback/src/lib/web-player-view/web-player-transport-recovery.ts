import { computed, signal } from '@angular/core';
import {
    PlaybackDiagnosticCode,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';

type Position = Pick<HTMLVideoElement, 'currentTime' | 'duration'>;

/** Owns recovery for VOD transport interruptions after a seek or user pause. */
export class WebPlayerTransportRecovery {
    private paused: {
        video: HTMLVideoElement;
        token: symbol;
        at: number;
        position: Position;
    } | null = null;
    private played: { video: HTMLVideoElement; token: symbol } | null = null;
    private seek: {
        video: HTMLVideoElement;
        token: symbol;
        at: number;
        playing: boolean;
        position: Position;
    } | null = null;
    private resumeToken: symbol | null = null;
    private lastSeekRetry = -Infinity;
    private readonly pendingToken = signal<symbol | null>(null);
    readonly pending = computed(() => this.pendingToken() === this.token());

    private readonly onPlaying = (event: Event): void => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        if (
            this.played?.video === event.target &&
            this.played.token !== this.token()
        )
            return;
        this.played = { video: event.target, token: this.token() };
        this.paused = null;
        this.resumeToken = null;
        this.pendingToken.set(null);
    };
    private readonly onPause = (event: Event): void => {
        const video = event.target;
        if (
            !(video instanceof HTMLVideoElement) ||
            video.error ||
            video.ended ||
            this.played?.video !== video ||
            this.played.token !== this.token()
        )
            return;
        this.paused = {
            video,
            token: this.token(),
            at: Date.now(),
            position: this.position(video),
        };
        this.resumeToken = null;
        this.rememberPosition(video);
    };
    private readonly onSeeking = (event: Event): void => {
        const video = event.target;
        if (!(video instanceof HTMLVideoElement) || !this.ownsPlayed(video))
            return;
        this.seek = {
            video,
            token: this.token(),
            at: Date.now(),
            playing: !video.paused,
            position: this.position(video),
        };
        if (this.paused?.token === this.token())
            this.paused.position = this.position(video);
        this.rememberPosition(video);
    };
    private readonly onPlay = (event: Event): void => {
        const paused = this.paused;
        if (event.target !== paused?.video || paused.token !== this.token())
            return;
        this.resumeToken = this.token();
        // A long pause can leave a dead HTTP range/segment connection without
        // an error event. Reopen only on explicit resume, preserving position.
        if (
            !this.isLive() &&
            (this.pending() || Date.now() - paused.at >= 60_000)
        ) {
            this.rememberPosition(paused.position);
            this.retry();
        }
    };

    constructor(
        private readonly host: HTMLElement,
        private readonly token: () => symbol,
        private readonly rememberPosition: (position: Position) => void,
        private readonly isLive: () => boolean,
        private readonly retry: () => void
    ) {
        // Media events do not bubble; capture survives each engine remount.
        host.addEventListener('playing', this.onPlaying, true);
        host.addEventListener('pause', this.onPause, true);
        host.addEventListener('seeking', this.onSeeking, true);
        host.addEventListener('play', this.onPlay, true);
    }

    defer(issue: PlaybackDiagnostic, isLive: boolean): boolean {
        if (
            isLive ||
            issue.code !== PlaybackDiagnosticCode.NetworkError ||
            issue.httpStatus === 401 ||
            issue.httpStatus === 403 ||
            this.paused?.token !== this.token()
        )
            return false;
        this.pendingToken.set(this.token());
        return true;
    }

    resumeRequested(): boolean {
        return (
            this.resumeToken === this.token() ||
            this.paused?.video.paused === false
        );
    }

    recoverSeek(issue: PlaybackDiagnostic, isLive: boolean): boolean {
        const seek = this.seek;
        if (
            isLive ||
            !seek ||
            seek.token !== this.token() ||
            !seek.playing ||
            Date.now() - seek.at > 10_000 ||
            Date.now() - this.lastSeekRetry < 30_000 ||
            issue.httpStatus === 401 ||
            issue.httpStatus === 403 ||
            (issue.code !== PlaybackDiagnosticCode.NetworkError &&
                issue.code !== PlaybackDiagnosticCode.MediaDecodeError)
        )
            return false;
        this.lastSeekRetry = Date.now();
        this.rememberPosition(seek.position);
        this.retry();
        return true;
    }

    private ownsPlayed(video: HTMLVideoElement): boolean {
        return (
            this.played?.video === video && this.played.token === this.token()
        );
    }

    private position(video: HTMLVideoElement): Position {
        return { currentTime: video.currentTime, duration: video.duration };
    }

    clear(): void {
        this.paused = null;
        this.seek = null;
        this.resumeToken = null;
        this.pendingToken.set(null);
    }

    destroy(): void {
        this.host.removeEventListener('playing', this.onPlaying, true);
        this.host.removeEventListener('pause', this.onPause, true);
        this.host.removeEventListener('seeking', this.onSeeking, true);
        this.host.removeEventListener('play', this.onPlay, true);
        this.clear();
        this.played = null;
    }
}
