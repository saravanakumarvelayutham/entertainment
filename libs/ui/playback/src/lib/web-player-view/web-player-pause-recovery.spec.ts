import { signal } from '@angular/core';
import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';
import { WebPlayerPauseRecovery } from './web-player-pause-recovery';

describe('WebPlayerPauseRecovery', () => {
    let host: HTMLElement;
    let video: HTMLVideoElement;
    let recovery: WebPlayerPauseRecovery;
    let token: ReturnType<typeof signal<symbol>>;
    let remember: jest.Mock;
    const issue: PlaybackDiagnostic = {
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.Native,
        sourceUrl: '',
        container: 'mp4',
        audioCodecs: [],
        videoCodecs: [],
    };

    beforeEach(() => {
        host = document.createElement('div');
        video = document.createElement('video');
        host.append(video);
        token = signal(Symbol());
        remember = jest.fn();
        recovery = new WebPlayerPauseRecovery(host, token, remember);
    });
    afterEach(() => recovery.destroy());

    function pauseAfterPlaying(): void {
        video.dispatchEvent(new Event('playing'));
        video.dispatchEvent(new Event('pause'));
    }

    it('captures non-bubbling pauses, saves position and waits for explicit resume after a paused VOD outage', () => {
        pauseAfterPlaying();
        expect(remember).toHaveBeenCalledWith(video);
        expect(recovery.defer(issue, false)).toBe(true);
        expect(recovery.pending()).toBe(true);
        recovery.clear();
        expect(recovery.pending()).toBe(false);
        // A failed replacement is a normal error, not another paused retry.
        expect(recovery.defer(issue, false)).toBe(false);
    });

    it('never defers initial playback errors or error-induced pauses', () => {
        video.dispatchEvent(new Event('pause'));
        expect(recovery.defer(issue, false)).toBe(false);
        video.dispatchEvent(new Event('playing'));
        Object.defineProperty(video, 'error', { value: { code: 2 } });
        video.dispatchEvent(new Event('pause'));
        expect(recovery.defer(issue, false)).toBe(false);
        expect(remember).not.toHaveBeenCalled();
    });

    it.each([
        { ...issue, code: PlaybackDiagnosticCode.MediaDecodeError },
        { ...issue, httpStatus: 401 },
        { ...issue, httpStatus: 403 },
    ])(
        'keeps non-recoverable evidence on the normal error path: %j',
        (failure) => {
            pauseAfterPlaying();
            expect(recovery.defer(failure, false)).toBe(false);
        }
    );

    it('excludes live playback and preserves the resume intent before playing', () => {
        pauseAfterPlaying();
        expect(recovery.defer(issue, true)).toBe(false);
        Object.defineProperty(video, 'paused', { value: false });
        expect(recovery.defer(issue, false)).toBe(true);
        expect(recovery.resumeRequested()).toBe(true);
    });

    it('invalidates pending recovery on source, player or session replacement', () => {
        pauseAfterPlaying();
        recovery.defer(issue, false);
        token.set(Symbol());
        expect(recovery.pending()).toBe(false);
        expect(recovery.defer(issue, false)).toBe(false);
        video.dispatchEvent(new Event('pause'));
        expect(remember).toHaveBeenCalledTimes(1);
    });

    it('clears an outage when the engine recovers itself and removes listeners at disposal', () => {
        pauseAfterPlaying();
        recovery.defer(issue, false);
        video.dispatchEvent(new Event('playing'));
        expect(recovery.pending()).toBe(false);
        recovery.destroy();
        video.dispatchEvent(new Event('pause'));
        expect(remember).toHaveBeenCalledTimes(1);
    });
});
