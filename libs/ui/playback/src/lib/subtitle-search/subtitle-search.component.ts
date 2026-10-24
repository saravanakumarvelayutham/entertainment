import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    Injector,
    OnDestroy,
    effect,
    inject,
    input,
    output,
    signal,
    untracked,
    afterNextRender,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
    SubtitleMatchService,
    type SubtitleMatch,
    type SubtitleSearchQuery,
    type SubtitleTitleMatch,
} from '@iptvnator/services';
import type {
    PlayerController,
    PlayerMediaTitle,
    PlayerSubtitleTarget,
} from '../player-controls/player-controls.model';
import {
    confidentSubtitleTitle,
    subtitleQueryForTitle,
} from './subtitle-search-query';

@Component({
    selector: 'app-subtitle-search',
    imports: [TranslatePipe],
    templateUrl: './subtitle-search.component.html',
    styleUrl: './subtitle-search.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubtitleSearchComponent implements OnDestroy {
    readonly controller = input.required<PlayerController>();
    readonly mediaTitle = input<PlayerMediaTitle | null>(null);
    readonly selected = output<void>();
    readonly started = output<void>();
    readonly expanded = signal(false);
    readonly editing = signal(true);
    readonly title = signal('');
    readonly type = signal<'movie' | 'series'>('movie');
    readonly year = signal('');
    readonly season = signal('1');
    readonly episode = signal('1');
    readonly busy = signal(false);
    readonly message = signal('');
    readonly titles = signal<SubtitleTitleMatch[]>([]);
    readonly subtitles = signal<SubtitleMatch[]>([]);
    readonly matchedTitle = signal('');
    private readonly service = inject(SubtitleMatchService);
    private readonly host =
        inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private readonly injector = inject(Injector);
    private request?: AbortController;
    private target: PlayerSubtitleTarget | null = null;
    private query?: SubtitleSearchQuery;

    constructor() {
        effect(() => {
            const media = this.mediaTitle();
            void this.controller();
            untracked(() => {
                this.cancel();
                const query = subtitleQueryForTitle(media);
                this.title.set(query.title);
                this.type.set(query.type);
                this.year.set(query.year?.toString() ?? '');
                this.season.set((query.season ?? 1).toString());
                this.episode.set((query.episode ?? 1).toString());
                this.titles.set([]);
                this.subtitles.set([]);
                this.message.set('');
                this.matchedTitle.set('');
                this.editing.set(true);
            });
        });
    }

    open(): void {
        this.expanded.set(true);
        if (this.title().trim()) void this.search();
    }

    async search(event?: Event): Promise<void> {
        event?.preventDefault();
        this.started.emit();
        this.cancel();
        this.titles.set([]);
        this.subtitles.set([]);
        this.matchedTitle.set('');
        this.message.set('');
        const query = this.readQuery();
        if (!query) {
            this.message.set('INVALID');
            return;
        }
        this.target = this.controller().getSubtitleTarget?.() ?? null;
        if (!this.target) {
            this.message.set('SOURCE_CHANGED');
            return;
        }
        const request = new AbortController();
        this.request = request;
        this.query = query;
        this.busy.set(true);
        try {
            const titles = await this.service.searchTitles(
                query,
                request.signal
            );
            if (request.signal.aborted) return;
            this.titles.set(titles);
            this.editing.set(!titles.length);
            const match = confidentSubtitleTitle(titles, query);
            if (match) await this.findSubtitles(match, request);
            else if (!titles.length) this.message.set('NO_TITLES');
            this.focusResults();
        } catch {
            if (!request.signal.aborted) this.message.set('ERROR');
        } finally {
            if (!request.signal.aborted) this.busy.set(false);
        }
    }

    async chooseTitle(match: SubtitleTitleMatch): Promise<void> {
        if (this.busy() || !this.request || !this.query) return;
        this.busy.set(true);
        this.message.set('');
        const request = this.request;
        try {
            await this.findSubtitles(match, request);
        } catch {
            if (!request.signal.aborted) this.message.set('ERROR');
        } finally {
            if (!request.signal.aborted) this.busy.set(false);
        }
    }

    async load(match: SubtitleMatch): Promise<void> {
        const request = this.request;
        const target = this.target;
        if (!request || request.signal.aborted || !target || this.busy())
            return;
        this.busy.set(true);
        this.message.set('');
        try {
            const file = await this.service.download(match, request.signal);
            if (request.signal.aborted) return;
            if (!target.load(file)) {
                this.message.set('SOURCE_CHANGED');
                return;
            }
            this.selected.emit();
            this.message.set('LOADED');
        } catch {
            if (!request.signal.aborted) this.message.set('ERROR');
        } finally {
            if (!request.signal.aborted) this.busy.set(false);
        }
    }

    ngOnDestroy(): void {
        this.cancel();
    }

    private cancel(): void {
        this.request?.abort();
        this.request = undefined;
        this.busy.set(false);
        this.target = null;
    }

    private async findSubtitles(
        match: SubtitleTitleMatch,
        request: AbortController
    ): Promise<void> {
        const query = this.query;
        if (!query) return;
        const subtitles = await this.service.findEnglish(
            match,
            query,
            request.signal
        );
        if (request.signal.aborted) return;
        this.matchedTitle.set(
            `${match.title}${match.year ? ` (${match.year})` : ''}`
        );
        this.subtitles.set(subtitles);
        this.message.set(subtitles.length ? 'CHOOSE_RELEASE' : 'NO_SUBTITLES');
        this.focusResults();
    }

    private focusResults(): void {
        const doc = this.host.ownerDocument;
        const active = doc.activeElement;
        if (active !== doc.body && !this.host.contains(active)) return;
        afterNextRender(
            () => {
                if (
                    doc.activeElement !== active &&
                    doc.activeElement !== doc.body
                )
                    return;
                this.host
                    .querySelector<HTMLElement>('.result:not(:disabled)')
                    ?.focus();
            },
            { injector: this.injector }
        );
    }

    private readQuery(): SubtitleSearchQuery | null {
        const title = this.title().trim();
        const year = this.year().trim() ? Number(this.year()) : undefined;
        const season = Number(this.season());
        const episode = Number(this.episode());
        if (
            title.length < 2 ||
            title.length > 200 ||
            /:\/\//.test(title) ||
            (year !== undefined &&
                (!Number.isInteger(year) || year < 1888 || year > 2100)) ||
            (this.type() === 'series' &&
                (!Number.isInteger(season) ||
                    season < 0 ||
                    season > 999 ||
                    !Number.isInteger(episode) ||
                    episode < 1 ||
                    episode > 9999))
        )
            return null;
        return {
            title,
            type: this.type(),
            ...(year === undefined ? {} : { year }),
            ...(this.type() === 'series' ? { season, episode } : {}),
        };
    }
}
