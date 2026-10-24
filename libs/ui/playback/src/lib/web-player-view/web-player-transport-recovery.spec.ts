import { signal } from '@angular/core';
import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
} from '@iptvnator/playback/util';
import { WebPlayerTransportRecovery } from './web-player-transport-recovery';

describe('WebPlayerTransportRecovery', () => {
    let host: HTMLElement;
    let video: HTMLVideoElement;
    let recovery: WebPlayerTransportRecovery;
    let retry: jest.Mock;
    let isLive: boolean;
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
        retry = jest.fn(() => recovery.clear());
        isLive = false;
        recovery = new WebPlayerTransportRecovery(
            host,
            token,
            remember,
            () => isLive,
            retry
        );
    });
    afterEach(() => {
        recovery.destroy();
        jest.useRealTimers();
    });

    it('reopens a long-paused VOD only on explicit resume, even without a network error', () => {
        jest.useFakeTimers();
        pauseAfterPlaying();
        jest.advanceTimersByTime(60_001);
        expect(retry).not.toHaveBeenCalled();
        video.dispatchEvent(new Event('play'));
        expect(retry).toHaveBeenCalledTimes(1);
        video.dispatchEvent(new Event('play'));
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('preserves explicit resume intent even when an engine error pauses the video again', () => {
        pauseAfterPlaying();
        video.dispatchEvent(new Event('play'));
        expect(video.paused).toBe(true);
        Object.defineProperty(video, 'error', { value: { code: 2 } });
        video.dispatchEvent(new Event('pause'));
        expect(recovery.resumeRequested()).toBe(true);
        expect(recovery.defer(issue, false)).toBe(true);
    });

    it('resumes a deferred connection error through the native play event', () => {
        pauseAfterPlaying();
        recovery.defer(issue, false);
        video.dispatchEvent(new Event('play'));
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it('leaves short pauses and live pauses on their existing playback path', () => {
        jest.useFakeTimers();
        pauseAfterPlaying();
        video.dispatchEvent(new Event('play'));
        expect(retry).not.toHaveBeenCalled();
        isLive = true;
        jest.advanceTimersByTime(60_001);
        video.dispatchEvent(new Event('play'));
        expect(retry).not.toHaveBeenCalled();
    });

    function seekWhilePlaying(): void {
        video.dispatchEvent(new Event('playing'));
        Object.defineProperty(video, 'paused', {
            configurable: true,
            value: false,
        });
        video.dispatchEvent(new Event('seeking'));
    }

    it.each([
        PlaybackDiagnosticCode.NetworkError,
        PlaybackDiagnosticCode.MediaDecodeError,
    ])(
        'recovers %s after rapid seeks and saves the latest requested position',
        (code) => {
            seekWhilePlaying();
            video.currentTime = 120;
            video.dispatchEvent(new Event('seeking'));
            expect(remember).toHaveBeenLastCalledWith(video);
            expect(recovery.recoverSeek({ ...issue, code }, false)).toBe(true);
            expect(retry).toHaveBeenCalledTimes(1);
            // A failed replacement must surface normally rather than loop.
            expect(recovery.recoverSeek({ ...issue, code }, false)).toBe(false);
        }
    );

    it('bounds seek retries across player remounts and permits later independent seeks', () => {
        jest.useFakeTimers();
        seekWhilePlaying();
        expect(recovery.recoverSeek(issue, false)).toBe(true);
        token.set(Symbol());
        video = document.createElement('video');
        host.replaceChildren(video);
        seekWhilePlaying();
        expect(recovery.recoverSeek(issue, false)).toBe(false);
        jest.advanceTimersByTime(30_000);
        video.dispatchEvent(new Event('seeking'));
        expect(recovery.recoverSeek(issue, false)).toBe(true);
    });

    it('does not retry startup, stale, paused, live, authorization or unsupported-media failures', () => {
        expect(recovery.recoverSeek(issue, false)).toBe(false);
        seekWhilePlaying();
        expect(recovery.recoverSeek(issue, true)).toBe(false);
        expect(recovery.recoverSeek({ ...issue, httpStatus: 401 }, false)).toBe(
            false
        );
        expect(
            recovery.recoverSeek(
                { ...issue, code: PlaybackDiagnosticCode.UnsupportedCodec },
                false
            )
        ).toBe(false);
        expect(recovery.recoverSeek({ ...issue, httpStatus: 403 }, false)).toBe(
            false
        );
        token.set(Symbol());
        expect(recovery.recoverSeek(issue, false)).toBe(false);
        video.dispatchEvent(new Event('playing'));
        Object.defineProperty(video, 'paused', {
            configurable: true,
            value: true,
        });
        video.dispatchEvent(new Event('seeking'));
        expect(recovery.recoverSeek(issue, false)).toBe(false);
    });

    it('expires seek evidence and ignores disposed listeners and old source events', () => {
        jest.useFakeTimers();
        seekWhilePlaying();
        jest.advanceTimersByTime(10_001);
        expect(recovery.recoverSeek(issue, false)).toBe(false);
        token.set(Symbol());
        video.dispatchEvent(new Event('play'));
        recovery.destroy();
        video.dispatchEvent(new Event('seeking'));
        expect(retry).not.toHaveBeenCalled();
    });

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
        video.dispatchEvent(new Event('playing'));
        video.dispatchEvent(new Event('pause'));
        expect(recovery.defer(issue, false)).toBe(false);
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
