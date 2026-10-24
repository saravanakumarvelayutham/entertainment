import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    computed,
    ElementRef,
    OnDestroy,
    NgZone,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import { applyChannelNameStrip } from '@iptvnator/shared/m3u-utils';
import { RailAutoRollDirective } from './rail-auto-roll.directive';

export interface DashboardRailAction {
    id: string;
    labelKey?: string;
    /** Already-localized copy for contextual actions such as explanations. */
    label?: string;
    icon: string;
    destructive?: boolean;
    disabled?: boolean;
    separatorBefore?: boolean;
    pressed?: boolean;
}

export interface DashboardRailCard {
    id: string;
    title: string;
    subtitle?: string;
    imageUrl?: string;
    icon: string;
    contentType?: 'live' | 'movie' | 'series';
    link: string[];
    queryParams?: Record<string, string>;
    state?: Record<string, unknown>;
    actions?: DashboardRailAction[];
    epgLookupKey?: string;

    /**
     * Optional EPG enrichment shown by the 'channel' rail layout. Populated
     * asynchronously after the card list is computed — when null/undefined
     * the channel card renders without the program subtitle/progress.
     */
    nowPlayingTitle?: string | null;
    /** Localised time range like "12:15 – 13:40". */
    nowPlayingTimeRange?: string | null;
    /** 0–100, % through the current program. */
    nowPlayingProgress?: number | null;

    /**
     * 0–100 watched, attached for movies/series with a resume position so
     * the cover layout can render a thin "watched up to here" bar at the
     * bottom of the poster. Live cards and content without a tracked
     * position leave this unset.
     */
    watchProgress?: number | null;

    /**
     * Localised "S{n} · E{n}" badge for series with a tracked episode
     * position. Renders as a small chip next to the card subtitle so the
     * user can see which episode they were on without opening the show.
     */
    episodeBadge?: string | null;

    /**
     * Subscription-expiry warning for portal source cards: a quiet amber
     * chip when the account expires soon, an error-toned one once it has.
     * The chip is passive — account details stay behind ⋮ → Account info.
     */
    expiryBadge?: { kind: 'expiring' | 'expired'; label: string } | null;

    /**
     * Landscape artwork for the 'landscape' layout (Continue Watching). When
     * absent the card falls back to a blurred copy of the poster behind the
     * sharp, contained poster so the still never shows a stretched portrait.
     */
    backdropUrl?: string;

    /**
     * Translation key + params for the "17m left" caption under a landscape
     * card. Pre-computed from the playback position, like `watchProgress`.
     */
    remainingLabel?: DashboardRailTranslatedLabel | null;

    /**
     * 1-based position for the 'ranked' layout (Top 10). Rendered as the
     * large outlined numeral beside the poster; absent cards render unranked.
     */
    rank?: number | null;
}

export interface DashboardRailTranslatedLabel {
    readonly key: string;
    readonly params: Record<string, number>;
}

/**
 * Visual layout of the rail's cards.
 *  - 'cover': portrait poster (Netflix-style), used for movies/series and
 *    recently-added catalog items.
 *  - 'landscape': 16:9 still with a progress bar and a remaining-time
 *    caption, used for Continue Watching, where "where was I" matters more
 *    than the poster.
 *  - 'ranked': portrait poster with a large outlined rank numeral, used for
 *    the Top 10 rail.
 *  - 'channel': programme-first live card (logo + channel row, the current
 *    programme as the headline, progress), used for live TV. TV station
 *    logos are small, so inflating them into 2:3 posters wastes space the
 *    cards never use.
 *  - 'recommendation': landscape explanation card with inline taste feedback.
 */
export type DashboardRailLayout =
    'cover' | 'landscape' | 'ranked' | 'channel' | 'recommendation';

export interface DashboardRailActionSelection {
    action: DashboardRailAction;
    card: DashboardRailCard;
}

@Component({
    selector: 'lib-dashboard-rail',
    imports: [
        MatButtonModule,
        MatIcon,
        MatMenuModule,
        RouterLink,
        TranslatePipe,
        RailAutoRollDirective,
    ],
    templateUrl: './dashboard-rail.component.html',
    styleUrl: './dashboard-rail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardRailComponent implements AfterViewInit, OnDestroy {
    private readonly settingsStore = inject(SettingsStore);
    private readonly zone = inject(NgZone);

    readonly label = input.required<string>();
    readonly items = input.required<DashboardRailCard[]>();
    readonly loopingItems = computed(() => [...this.items(), ...this.items()]);
    readonly seeAllLink = input<string[] | null>(null);
    readonly seeAllState = input<Record<string, unknown> | null>(null);
    readonly aspectRatio = input<string>('2 / 3');
    readonly layout = input<DashboardRailLayout>('cover');
    readonly autoRoll = input(true);
    readonly testId = input<string | null>(null);
    readonly actionSelected = output<DashboardRailActionSelection>();
    readonly autoRollEligible = computed(
        () =>
            this.autoRoll() &&
            this.layout() !== 'channel' &&
            this.items().some(
                (card) =>
                    card.contentType === 'movie' ||
                    card.contentType === 'series'
            )
    );
    /**
     * True total in the underlying dataset. Shown as a count badge next to
     * the rail label. Falls back to `items().length` when not supplied.
     */
    readonly totalCount = input<number | null>(null);

    private readonly track =
        viewChild.required<ElementRef<HTMLDivElement>>('track');

    readonly canScrollLeft = signal(false);
    readonly canScrollRight = signal(false);
    readonly failedImages = signal<Record<string, true>>({});
    private readonly viewReady = signal(false);

    private resizeObserver?: ResizeObserver;
    private resetFrameId: number | null = null;
    private settleFrameId: number | null = null;
    private itemOrder = '';

    constructor() {
        effect(() => {
            const order = this.items()
                .map((card) => card.id)
                .join('\0');
            if (!this.viewReady()) return;
            if (order === this.itemOrder) return;
            this.itemOrder = order;
            this.scheduleResetToStart();
        });
    }

    ngAfterViewInit(): void {
        this.viewReady.set(true);
        this.updateScrollState();
        this.resizeObserver = new ResizeObserver(() =>
            this.updateScrollState()
        );
        this.resizeObserver.observe(this.track().nativeElement);
        this.zone.runOutsideAngular(() =>
            this.track().nativeElement.addEventListener(
                'scroll',
                this.trackScrolled,
                { passive: true }
            )
        );
    }

    ngOnDestroy(): void {
        this.resizeObserver?.disconnect();
        this.cancelPendingReset();
        if (this.viewReady()) {
            this.track().nativeElement.removeEventListener(
                'scroll',
                this.trackScrolled
            );
        }
    }

    onScroll(): void {
        this.updateScrollState();
    }
    private readonly trackScrolled = (): void => this.updateScrollState();

    scrollBy(direction: 1 | -1): void {
        const el = this.track().nativeElement;
        const mode = this.settingsStore.workspaceMotion?.() ?? 'system';
        const reduced =
            mode === 'reduced' ||
            (mode !== 'full' &&
                window.matchMedia?.('(prefers-reduced-motion: reduce)')
                    .matches);
        el.scrollBy({
            left: direction * el.clientWidth * 0.85,
            behavior: reduced ? 'auto' : 'smooth',
        });
    }

    onTrackKeydown(event: KeyboardEvent): void {
        // Links keep their native Enter/Space behavior; only the track owns paging.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            this.scrollBy(event.key === 'ArrowRight' ? 1 : -1);
        }
    }

    markFailed(id: string): void {
        this.failedImages.update((state) =>
            state[id] ? state : { ...state, [id]: true }
        );
    }

    stopActionEvent(event: Event): void {
        event.stopPropagation();
    }

    /**
     * Landscape cards prefer real backdrop artwork; without one the poster
     * is shown contained over its own blurred copy (`rail__art-bg`).
     */
    protected landscapeArt(
        card: DashboardRailCard
    ): { url: string; contained: boolean } | null {
        if (card.backdropUrl && !this.failedImages()[card.id]) {
            return { url: card.backdropUrl, contained: false };
        }
        if (card.imageUrl && !this.failedImages()[`${card.id}:poster`]) {
            return { url: card.imageUrl, contained: true };
        }
        return null;
    }

    /**
     * A failed backdrop demotes the card to the poster treatment instead of
     * hiding the art outright; a failed poster then reaches the icon tile.
     */
    markLandscapeFailed(card: DashboardRailCard, contained: boolean): void {
        this.markFailed(contained ? `${card.id}:poster` : card.id);
    }

    /** Prefix stripping applies to live-channel cards only, never VOD/series. */
    protected cardTitle(card: DashboardRailCard): string {
        return applyChannelNameStrip(
            card.title,
            card.contentType === 'live' &&
                this.settingsStore.stripCountryPrefix?.()
        );
    }

    selectAction(
        card: DashboardRailCard,
        action: DashboardRailAction,
        event: Event
    ): void {
        event.stopPropagation();
        this.actionSelected.emit({ card, action });
    }

    private updateScrollState(): void {
        const el = this.track().nativeElement;
        this.canScrollLeft.set(el.scrollLeft > 4);
        this.canScrollRight.set(
            el.scrollLeft + el.clientWidth < el.scrollWidth - 4
        );
    }

    private scheduleResetToStart(): void {
        this.cancelPendingReset();
        this.resetFrameId = requestAnimationFrame(() => {
            this.resetFrameId = null;
            this.settleFrameId = requestAnimationFrame(() => {
                this.settleFrameId = null;
                const el = this.track().nativeElement;
                el.scrollTo({ left: 0, behavior: 'auto' });
                this.updateScrollState();
            });
        });
    }

    private cancelPendingReset(): void {
        if (this.resetFrameId !== null) {
            cancelAnimationFrame(this.resetFrameId);
            this.resetFrameId = null;
        }
        if (this.settleFrameId !== null) {
            cancelAnimationFrame(this.settleFrameId);
            this.settleFrameId = null;
        }
    }
}
