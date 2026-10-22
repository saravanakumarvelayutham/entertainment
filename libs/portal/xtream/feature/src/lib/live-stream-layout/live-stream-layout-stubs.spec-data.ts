import {
    ChangeDetectionStrategy,
    Component,
    Directive,
    input,
    output,
    signal,
} from '@angular/core';
import {
    EpgProgram,
    RecordingStartMetadata,
    RecordingStoppedEvent,
} from '@iptvnator/shared/interfaces';
import {
    EpgProgramActivationEvent,
    EpgTimelineSummary,
} from '@iptvnator/ui/epg';
import { PlaybackFallbackRequest } from '@iptvnator/ui/playback';

@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-portal-channels-list',
    standalone: true,
    template: '<div data-test-id="portal-channels-list-stub"></div>',
})
export class StubPortalChannelsListComponent {
    readonly sortMode = input<'server' | 'name-asc' | 'name-desc'>('server');
    readonly channelsOverride = input<unknown[] | null>(null);
    readonly searchTermInput = input('');
    readonly revealRequest = input<unknown>(null);
    readonly filteredChannels = signal<unknown[]>([]);
    readonly playClicked = output<unknown>();
    readonly playbackRequested = output<unknown>();
}

@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-grid-list',
    standalone: true,
    template: '<div data-test-id="grid-list-stub"></div>',
})
export class StubGridListComponent {
    readonly items = input<unknown[]>([]);
    readonly isLoading = input(false);
    readonly isAppending = input(false);
    readonly appendError = input(false);
    readonly searchTerm = input('');
    readonly variant = input<'poster' | 'logo'>('poster');
    readonly type = input<string>();
    readonly itemClicked = output<unknown>();
    readonly retryLoadMore = output<void>();
}

@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-web-player-view',
    standalone: true,
    template: '',
})
export class StubWebPlayerViewComponent {
    readonly playbackSessionKey = input.required<string>();
    readonly streamUrl = input('');
    readonly title = input('');
    readonly playback = input<unknown>(null);
    readonly recordingMetadata = input<RecordingStartMetadata | null>(null);
    readonly externalFallbackRequested = output<PlaybackFallbackRequest>();
    readonly recordingStopped = output<RecordingStoppedEvent>();
}

// Matches both live-panel selectors so the host's timeline ↔ list swap can be
// asserted by tag name; both branches share the identical contract.
@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-epg-timeline, app-epg-list-view',
    standalone: true,
    template: `
        <div class="live-epg-panel-label">{{ summaryLabelKey() }}</div>
        <div class="live-epg-panel-summary">{{ summary()?.title }}</div>
    `,
})
export class StubEpgTimelineComponent {
    readonly programs = input<EpgProgram[]>([]);
    readonly channelName = input('');
    readonly channelLogo = input('');
    readonly sourceLabel = input('');
    readonly archivePlaybackAvailable = input(false);
    readonly archiveDownloadAvailable = input(false);
    readonly archiveContextKey = input<string | null>(null);
    readonly archiveDays = input(0);
    readonly activeProgram = input<EpgProgram | null>(null);
    readonly isLivePlayback = input(true);
    readonly loading = input(false);
    readonly selectedDate = input<string | null>(null);
    readonly collapsed = input(false);
    readonly summary = input<EpgTimelineSummary | null>(null);
    readonly summaryLabelKey = input('');
    readonly offsetMinutes = input(0);
    readonly programActivated = output<EpgProgramActivationEvent>();
    readonly returnToLive = output<void>();
    readonly selectedDateChange = output<string>();
    readonly collapsedChange = output<boolean>();
}

@Directive({
    selector: '[appResizable]',
    standalone: true,
})
export class StubResizableDirective {}

export const sampleChannel = {
    xtream_id: 101,
    name: 'Channel 101',
    stream_icon: 'channel-101.png',
    tv_archive: 1,
    tv_archive_duration: 3,
};
export const playlist = {
    id: 'playlist-1',
    serverUrl: 'http://demo.example',
    username: 'demo',
    password: 'secret',
};

@Component({
    selector: 'app-live-on-now-stage',
    template: '<div data-test-id="stub-live-on-now-stage"></div>',
})
export class StubLiveOnNowStageComponent {
    readonly tiles = input<readonly unknown[]>([]);
    readonly lastWatched = input<unknown>(null);
    readonly source = input<string>('favorites');
    readonly sourceLabel = input<string>('');
    readonly nowMs = input<number>(0);
    readonly channelSelected = output<string>();
}

/** Component-scoped `XtreamLiveOnNowService` replacement for layout specs. */
export function createLiveOnNowServiceStub() {
    return {
        active: signal(false),
        nowMs: signal(0),
        tiles: signal([]),
        lastWatched: signal(null),
        source: signal('category'),
        resolveChannel: jest.fn(() => null),
        displayedChannels: jest.fn(() => []),
    };
}

/** `overrideProvider` argument for the stub above, kept to one call line. */
export function liveOnNowStubProvider() {
    return { useValue: createLiveOnNowServiceStub() };
}
