import { computed, signal } from '@angular/core';
import {
    PlaybackDiagnosticCode,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';

/** A paused VOD connection can expire while the engine still fetches data.
 * Preserve the user's pause and reload only when they explicitly resume. */
export class WebPlayerPauseRecovery {
    private paused: { video: HTMLVideoElement; token: symbol } | null = null;
    private played: { video: HTMLVideoElement; token: symbol } | null = null;
    private readonly pendingToken = signal<symbol | null>(null);
    readonly pending = computed(() => this.pendingToken() === this.token());

    private readonly onPlaying = (event: Event): void => {
        if (!(event.target instanceof HTMLVideoElement)) return;
        this.played = { video: event.target, token: this.token() };
        this.clear();
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
        this.paused = { video, token: this.token() };
        this.rememberPosition(video);
    };

    constructor(
        private readonly host: HTMLElement,
        private readonly token: () => symbol,
        private readonly rememberPosition: (video: HTMLVideoElement) => void
    ) {
        // Media events do not bubble; capture survives each engine remount.
        host.addEventListener('playing', this.onPlaying, true);
        host.addEventListener('pause', this.onPause, true);
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
        return this.paused?.video.paused === false;
    }

    clear(): void {
        this.paused = null;
        this.pendingToken.set(null);
    }

    destroy(): void {
        this.host.removeEventListener('playing', this.onPlaying, true);
        this.host.removeEventListener('pause', this.onPause, true);
        this.clear();
        this.played = null;
    }
}
