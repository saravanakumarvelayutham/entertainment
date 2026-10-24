import {
    ChangeDetectionStrategy,
    Component,
    Injector,
    OnDestroy,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
} from '@angular/core';
import {
    SettingsStore,
    SubtitleMatchService,
    rankEnglishSubtitleReleases,
    type SubtitleSearchQuery,
} from '@iptvnator/services';
import type {
    PlayerController,
    PlayerControlsState,
    PlayerMediaTitle,
    PlayerSubtitleTarget,
} from '../player-controls/player-controls.model';
import {
    confidentSubtitleTitle,
    subtitleQueryForTitle,
} from './subtitle-search-query';

type AutoSubtitleStatus =
    'OFF' | 'SEARCHING' | 'LOADED' | 'NO_MATCH' | 'ERROR' | 'MANUAL';

/** Playback-owned automation stays mounted when the subtitle popover is closed. */
@Component({
    selector: 'app-auto-english-subtitles',
    template: '',
    host: {
        'data-test-id': 'player-auto-subtitles',
        '[attr.data-status]': 'status()',
    },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutoEnglishSubtitlesComponent implements OnDestroy {
    readonly controller = input.required<PlayerController>();
    readonly mediaTitle = input<PlayerMediaTitle | null>(null);
    readonly disabled = input(false);
    readonly selected = output<void>();
    readonly status = signal<AutoSubtitleStatus>('OFF');
    private readonly service = inject(SubtitleMatchService);
    private readonly injector = inject(Injector);
    private owner?: PlayerController;
    private key?: string;
    private mediaKey = '';
    private attempted = false;
    private explicitEnabled = false;
    private request?: AbortController;

    constructor() {
        effect(() => {
            const controller = this.controller();
            const state = controller.state();
            // Engine refreshes publish source changes even when the title is unchanged.
            controller.capabilities();
            const target = controller.getSubtitleTarget?.() ?? null;
            const media = this.mediaTitle();
            const disabled = this.disabled();
            // Only subtitle-capable sources need settings or provider access.
            const enabled =
                target?.key !== undefined &&
                this.injector.get(SettingsStore).autoEnglishSubtitles?.() !==
                    false;
            untracked(() =>
                this.update(
                    controller,
                    target,
                    state,
                    media,
                    !disabled &&
                        (enabled ||
                            (this.explicitEnabled &&
                                controller === this.owner &&
                                target?.key === this.key))
                )
            );
        });
    }

    /** An explicit track, Off, local file, manual search or speech action wins. */
    override(): void {
        this.explicitEnabled = false;
        this.cancel();
        this.attempted = true;
        this.status.set('MANUAL');
    }

    /** Explicit On retries matching, including after Off or a failed startup attempt. */
    enable(): void {
        const controller = this.controller();
        const target = controller.getSubtitleTarget?.() ?? null;
        if (!target || this.disabled() || controller.state().isLive) return;
        this.cancel();
        this.attempted = false;
        this.status.set('OFF');
        controller.commands.setSubtitleTrack(-1);
        this.update(
            controller,
            target,
            controller.state(),
            this.mediaTitle(),
            true,
            true
        );
    }

    ngOnDestroy(): void {
        this.cancel();
    }

    private update(
        controller: PlayerController,
        target: PlayerSubtitleTarget | null,
        state: PlayerControlsState,
        media: PlayerMediaTitle | null,
        enabled: boolean,
        explicit = false
    ): void {
        const key = target?.key;
        const mediaKey = `${media?.primary ?? ''}\n${media?.secondary ?? ''}\n${media?.year ?? ''}`;
        const sourceChanged = controller !== this.owner || key !== this.key;
        if (sourceChanged) this.explicitEnabled = false;
        if (sourceChanged || mediaKey !== this.mediaKey) {
            const keepManual = !sourceChanged && this.status() === 'MANUAL';
            this.cancel();
            this.owner = controller;
            this.key = key;
            this.mediaKey = mediaKey;
            this.attempted = keepManual;
            this.status.set(keepManual ? 'MANUAL' : 'OFF');
        }
        if (explicit) this.explicitEnabled = true;
        if (
            !enabled ||
            !target ||
            state.isLive ||
            ['ended', 'error'].includes(state.status)
        ) {
            this.cancel();
            if (this.status() === 'SEARCHING') {
                this.attempted = false;
                this.status.set('OFF');
            }
            return;
        }
        if (state.subtitlesEnabled && this.status() !== 'LOADED') {
            this.override();
            return;
        }
        if (
            this.attempted ||
            (!explicit && state.status !== 'playing') ||
            !media?.primary.trim()
        )
            return;
        const query = subtitleQueryForTitle(media);
        if (
            !query.title ||
            query.title.length > 200 ||
            query.title.includes('://')
        )
            return;
        if (
            (state.canNextEpisode || state.canPreviousEpisode) &&
            query.type !== 'series'
        ) {
            this.attempted = true;
            this.status.set('NO_MATCH');
            return;
        }
        this.attempted = true;
        this.status.set('SEARCHING');
        const request = new AbortController();
        this.request = request;
        void this.match(
            controller,
            target,
            query,
            `${media.primary} ${media.secondary ?? ''}`,
            request
        );
    }

    private async match(
        controller: PlayerController,
        target: PlayerSubtitleTarget,
        query: SubtitleSearchQuery,
        releaseHint: string,
        request: AbortController
    ): Promise<void> {
        try {
            const titles = await this.service.searchTitles(
                query,
                request.signal
            );
            if (request.signal.aborted) return;
            const title = confidentSubtitleTitle(titles, query);
            if (!title) {
                this.status.set('NO_MATCH');
                return;
            }
            const matches = await this.service.findEnglish(
                title,
                query,
                request.signal
            );
            if (request.signal.aborted) return;
            const ranked = rankEnglishSubtitleReleases(
                matches,
                query,
                releaseHint
            );
            if (!ranked.length) {
                this.status.set('NO_MATCH');
                return;
            }
            // A broken release must not prevent a bounded alternative from working.
            for (const candidate of ranked.slice(0, 3)) {
                try {
                    const file = await this.service.download(
                        candidate,
                        request.signal
                    );
                    if (request.signal.aborted) return;
                    if (controller.state().subtitlesEnabled) {
                        this.override();
                        return;
                    }
                    if (!target.load(file)) {
                        if (
                            controller.getSubtitleTarget?.()?.key !== target.key
                        )
                            return;
                        continue;
                    }
                    this.status.set('LOADED');
                    this.selected.emit();
                    return;
                } catch {
                    if (request.signal.aborted) return;
                }
            }
            this.status.set('ERROR');
        } catch {
            if (!request.signal.aborted) this.status.set('ERROR');
        }
    }

    private cancel(): void {
        this.request?.abort();
        this.request = undefined;
    }
}
