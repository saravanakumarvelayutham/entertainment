import { ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
} from '@iptvnator/playback/util';
import type { WebPlayerViewComponent } from './web-player-view.component';
import { StubVjsPlayerComponent } from './web-player-view.spec-stubs';

export function registerTransportRecoveryCases(
    context: () => {
        fixture: ComponentFixture<WebPlayerViewComponent>;
        component: WebPlayerViewComponent;
    }
): void {
    let fixture: ComponentFixture<WebPlayerViewComponent>;
    let component: WebPlayerViewComponent;
    beforeEach(() => ({ fixture, component } = context()));
    const setPlayback = () =>
        fixture.componentRef.setInput('playback', {
            streamUrl: 'https://example.com/movie.mp4',
            title: 'Movie',
            isLive: false,
        });
    const render = async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    };
    const vjs = (): StubVjsPlayerComponent =>
        fixture.debugElement.query(By.directive(StubVjsPlayerComponent))
            .componentInstance;
    const query = (id: string) =>
        fixture.nativeElement.querySelector('[data-test-id="' + id + '"]');
    const networkIssue = () => ({
        code: PlaybackDiagnosticCode.NetworkError,
        source: PlaybackDiagnosticSource.Native,
        sourceUrl: 'https://example.com/movie.mp4',
        container: 'mp4',
        audioCodecs: [],
        videoCodecs: [],
    });

    it('reopens VOD at the last rapid-seek target and surfaces a failed replacement', async () => {
        setPlayback();
        await render();
        const video = document.createElement('video');
        component.fullscreenSurface.append(video);
        Object.defineProperty(video, 'paused', { value: false });
        video.dispatchEvent(new Event('playing'));
        for (const position of [30, 60, 120]) {
            video.currentTime = position;
            video.dispatchEvent(new Event('seeking'));
        }
        // A terminal media failure may report zero before the diagnostic.
        video.currentTime = 0;
        vjs().timeUpdate.emit({ currentTime: 0, duration: 500 });
        vjs().playbackIssue.emit(networkIssue());
        await render();
        expect(vjs().options()).toEqual(
            expect.objectContaining({ reloadToken: 1 })
        );
        expect(vjs().startTime()).toBe(120);
        expect(query('playback-diagnostic-banner')).toBeNull();
        vjs().playbackIssue.emit(networkIssue());
        await render();
        expect(query('playback-diagnostic-banner')).not.toBeNull();
    });

    it('reopens a long-paused VOD on play without waiting for an engine error', async () => {
        setPlayback();
        await render();
        const video = document.createElement('video');
        component.fullscreenSurface.append(video);
        video.currentTime = 86;
        video.dispatchEvent(new Event('playing'));
        const now = jest.spyOn(Date, 'now');
        try {
            now.mockReturnValue(1_000);
            video.dispatchEvent(new Event('pause'));
            now.mockReturnValue(62_000);
            video.dispatchEvent(new Event('play'));
        } finally {
            now.mockRestore();
        }
        await render();
        expect(vjs().options()).toEqual(
            expect.objectContaining({ reloadToken: 1 })
        );
        expect(vjs().startTime()).toBe(86);
        expect(component.pausedRecoveryPending()).toBe(false);
        expect(query('playback-diagnostic-banner')).toBeNull();
    });
}
