import { tmdbPosterUrl } from './tmdb-config';
import { extractYear } from './tmdb-matcher';
import { TmdbSearchResult } from './tmdb.types';

const nonNegative = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, value)
        : 0;

/**
 * View-friendly projection of a `/discover` result, shared by the portal
 * Discover pages. Structurally a subset of `ActorFilmographyCredit`, so
 * both feed the same title-results grid.
 */
export interface DiscoverTitle {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    /**
     * TMDB's original-language title, kept as a matching alias: `title`
     * is localized to the app language while the provider catalog stores
     * whatever the panel named the file, which is often the original.
     */
    originalTitle: string | null;
    year: number | null;
    posterUrl: string | null;
    /** Raw ranking features retained for local, privacy-preserving scoring. */
    genreIds?: readonly number[];
    popularity?: number;
    voteAverage?: number | null;
    voteCount?: number;
}

/**
 * Maps raw discover results, dropping untitled entries and deduplicating
 * by TMDB id (concatenated pages can repeat entries when popularity
 * shifts between page fetches).
 */
export function mapDiscoverResults(
    results: readonly TmdbSearchResult[],
    mediaType: 'movie' | 'tv'
): DiscoverTitle[] {
    const seen = new Set<number>();
    const titles: DiscoverTitle[] = [];

    for (const result of results) {
        const title = (result.title ?? result.name ?? '').trim();
        if (!title || seen.has(result.id)) {
            continue;
        }
        seen.add(result.id);
        const originalTitle = (
            result.original_title ??
            result.original_name ??
            ''
        ).trim();
        const voteCount = nonNegative(result.vote_count);
        titles.push({
            tmdbId: result.id,
            mediaType,
            title,
            originalTitle:
                originalTitle && originalTitle !== title ? originalTitle : null,
            year: extractYear(result.release_date ?? result.first_air_date),
            posterUrl: tmdbPosterUrl(result.poster_path),
            genreIds: (result.genre_ids ?? []).filter(
                (id) => Number.isInteger(id) && id > 0
            ),
            popularity: nonNegative(result.popularity),
            voteAverage:
                voteCount > 0
                    ? Math.min(10, nonNegative(result.vote_average))
                    : null,
            voteCount,
        });
    }

    return titles;
}
