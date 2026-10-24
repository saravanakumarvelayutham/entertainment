import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    normalizeTitleKeys,
    titleYearsCompatible,
    TmdbMovieFacts,
    TmdbRecommendation,
} from '@iptvnator/shared/interfaces';

/** A verified playable recommendation; routing remains owned by its host. */
export interface MovieCompanionItem {
    key: string;
    title: string;
    posterUrl: string | null;
    year?: number | null;
    sourceLabel?: string;
}

@Component({
    selector: 'app-movie-companion',
    imports: [CurrencyPipe, DatePipe, MatIcon, TranslatePipe],
    templateUrl: './movie-companion.component.html',
    styleUrl: './movie-companion.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { 'data-test-id': 'movie-companion' },
})
export class MovieCompanionComponent {
    readonly facts = input<TmdbMovieFacts | null>();
    readonly recommendations = input<readonly TmdbRecommendation[]>([]);
    readonly availableItems = input<readonly MovieCompanionItem[]>([]);
    readonly itemSelected = output<string>();
    private readonly failedPosters = signal<ReadonlySet<string>>(new Set());

    readonly libraryItems = computed(() => {
        const seen = new Set<string>();
        return this.availableItems()
            .filter((item) => {
                if (!item.key || !item.title.trim() || seen.has(item.key))
                    return false;
                seen.add(item.key);
                return true;
            })
            .slice(0, 8);
    });

    readonly discoveryItems = computed(() => {
        const seen = new Set<number>();
        return this.recommendations()
            .filter((item) => {
                if (
                    !Number.isInteger(item.tmdbId) ||
                    item.tmdbId <= 0 ||
                    item.tmdbId === this.facts()?.tmdbId ||
                    !item.title.trim() ||
                    seen.has(item.tmdbId)
                )
                    return false;
                seen.add(item.tmdbId);
                return !this.libraryItems().some((available) => {
                    const provider = normalizeTitleKeys(available.title);
                    const title = normalizeTitleKeys(item.title).exact;
                    if (!titleYearsCompatible(available.year, item.year))
                        return false;
                    return (
                        provider.exact === title ||
                        (provider.base === title &&
                            titleYearsCompatible(
                                provider.trailingYear,
                                item.year
                            ))
                    );
                });
            })
            .slice(0, 6);
    });

    readonly factCards = computed(() => {
        const facts = this.facts();
        if (!facts) return [];
        return [
            {
                key: 'COLLECTION',
                icon: 'movie_filter',
                value: facts.collectionName,
            },
            {
                key: 'MUSIC',
                icon: 'music_note',
                value: facts.musicBy?.join(', '),
            },
            {
                key: 'SCREENPLAY',
                icon: 'edit_note',
                value: facts.screenplayBy?.join(', '),
            },
            {
                key: 'PRODUCTION',
                icon: 'local_movies',
                value: facts.productionCompanies?.join(', '),
            },
            { key: 'BUDGET', icon: 'payments', amount: facts.budget },
            {
                key: 'REVENUE',
                icon: 'confirmation_number',
                amount: facts.revenue,
            },
            {
                key: 'ORIGINAL_TITLE',
                icon: 'theaters',
                value: facts.originalTitle,
            },
            {
                key: 'LANGUAGE',
                icon: 'language',
                value: facts.originalLanguage?.toUpperCase(),
            },
            { key: 'RELEASE', icon: 'event', date: facts.releaseDate },
        ].filter(
            (card) =>
                card.value || card.date || (card.amount && card.amount > 0)
        );
    });

    readonly sourceUrl = computed(() => {
        const id = this.facts()?.tmdbId;
        return id && Number.isInteger(id) && id > 0 ? this.movieUrl(id) : null;
    });

    movieUrl(id: number): string {
        return `https://www.themoviedb.org/movie/${id}`;
    }

    posterFailed(url: string): void {
        this.failedPosters.update((failed) => new Set([...failed, url]));
    }

    hasPoster(url: string | null): url is string {
        return !!url && !this.failedPosters().has(url);
    }
}
