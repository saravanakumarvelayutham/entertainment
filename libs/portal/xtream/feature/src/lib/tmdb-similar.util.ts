import {
    TmdbRecommendation,
    bracketedReleaseYear,
    normalizeTitleKeys,
} from '@iptvnator/shared/interfaces';
import { extractYear, pickTitleMatchCandidate } from '@iptvnator/services';

/**
 * Matches TMDB recommendations against the provider catalog so the
 * "Similar" rail only shows titles the user can actually play.
 *
 * Matching is two-tier: TMDB titles are canonical (a trailing year is part
 * of the title — "Blade Runner 2049"), provider titles are dirty (a
 * trailing year is usually a release tag — "The Matrix 1999"). Both tiers
 * retain release evidence and share identity ranking with cross-portal
 * matches, so a title alone cannot override a known release or TMDB ID.
 */

export interface SimilarCatalogItem {
    id: number;
    categoryId: string;
    title: string;
    posterUrl: string | null;
}

/** Catalog rows vary by source (API vs DB) — fields are read structurally */
type CatalogStream = object;

function field(stream: CatalogStream, key: string): unknown {
    return (stream as Record<string, unknown>)[key];
}

function streamId(stream: CatalogStream): number | null {
    const candidate =
        field(stream, 'xtream_id') ??
        field(stream, 'stream_id') ??
        field(stream, 'series_id') ??
        field(stream, 'id');
    const parsed = Number(candidate);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function streamTitle(stream: CatalogStream): string {
    const title = field(stream, 'name') ?? field(stream, 'title');
    return typeof title === 'string' ? title : '';
}

function streamPoster(stream: CatalogStream): string | null {
    const poster =
        field(stream, 'stream_icon') ??
        field(stream, 'cover') ??
        field(stream, 'poster_url');
    return typeof poster === 'string' && poster !== '' ? poster : null;
}

export interface CatalogMatch {
    id: number;
    categoryId: string;
}

interface IndexedCatalogEntry extends CatalogMatch {
    trailingYear: number | null;
    tmdbId: number | null;
    title: string;
    posterUrl: string | null;
}

/**
 * Two-tier catalog index for per-title availability checks (actor page
 * filmography). Keep every candidate so identity can decide at lookup time.
 */
export interface CatalogTitleIndex {
    exact: Map<string, IndexedCatalogEntry[]>;
    base: Map<string, IndexedCatalogEntry[]>;
}

function positiveInteger(value: unknown): number | null {
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0
        ? parsed
        : null;
}

function addEntry(
    index: Map<string, IndexedCatalogEntry[]>,
    key: string,
    entry: IndexedCatalogEntry
): void {
    const entries = index.get(key);
    if (entries) {
        entries.push(entry);
    } else {
        index.set(key, [entry]);
    }
}

export function buildCatalogTitleIndex(
    streams: readonly CatalogStream[],
    wantedTitles?: readonly string[]
): CatalogTitleIndex {
    const exact = new Map<string, IndexedCatalogEntry[]>();
    const base = new Map<string, IndexedCatalogEntry[]>();
    const wanted = wantedTitles
        ? new Set(wantedTitles.map((title) => normalizeTitleKeys(title).exact))
        : null;
    for (const stream of streams) {
        const title = streamTitle(stream);
        const keys = normalizeTitleKeys(title);
        if (
            !keys.exact ||
            (wanted && !wanted.has(keys.exact) && !wanted.has(keys.base))
        ) {
            continue;
        }
        const id = streamId(stream);
        const categoryId =
            field(stream, 'category_id') ?? field(stream, 'categoryId');
        if (id === null || categoryId === undefined || categoryId === null) {
            continue;
        }
        const entry: IndexedCatalogEntry = {
            id,
            categoryId: String(categoryId),
            trailingYear:
                bracketedReleaseYear(title) ??
                positiveInteger(field(stream, 'release_year')) ??
                (typeof field(stream, 'releaseDate') === 'string'
                    ? extractYear(field(stream, 'releaseDate') as string)
                    : null),
            tmdbId: positiveInteger(field(stream, 'tmdb_id')),
            title,
            posterUrl: streamPoster(stream),
        };
        addEntry(exact, keys.exact, entry);
        // The base tier only exists for titles that carried a year tag
        if (keys.base !== keys.exact) {
            addEntry(base, keys.base, {
                ...entry,
                trailingYear: keys.trailingYear ?? entry.trailingYear,
            });
        }
    }
    return { exact, base };
}

/**
 * Looks up a TMDB title (canonical — never year-stripped) in the catalog
 * index. Identity ranking is shared with cross-portal matching: conflicting
 * IDs/years are rejected, then matching IDs and exact years win.
 */
export function lookupCatalogTitle(
    index: CatalogTitleIndex,
    title: string | readonly string[],
    year?: number | null,
    tmdbId?: number | null
): IndexedCatalogEntry | null {
    const candidates: IndexedCatalogEntry[] = [];
    const keys = new Set(
        (typeof title === 'string' ? [title] : title).map(
            (alias) => normalizeTitleKeys(alias).exact
        )
    );
    for (const key of keys) {
        if (key) {
            candidates.push(...(index.exact.get(key) ?? []));
            candidates.push(...(index.base.get(key) ?? []));
        }
    }
    return pickTitleMatchCandidate({ year: year ?? null, tmdbId }, candidates);
}

export function matchRecommendationsToCatalog(
    recommendations: readonly TmdbRecommendation[] | undefined,
    streams: readonly CatalogStream[],
    options: { excludeId?: number; limit?: number } = {}
): SimilarCatalogItem[] {
    if (!recommendations?.length || !streams.length) {
        return [];
    }

    const index = buildCatalogTitleIndex(
        streams,
        recommendations.map((recommendation) => recommendation.title)
    );
    const limit = options.limit ?? 12;
    const seenIds = new Set<number>();
    const matched: SimilarCatalogItem[] = [];

    for (const recommendation of recommendations) {
        if (matched.length >= limit) {
            break;
        }
        const stream = lookupCatalogTitle(
            index,
            recommendation.title,
            recommendation.year,
            recommendation.tmdbId
        );
        if (!stream) {
            continue;
        }
        const { id, categoryId } = stream;
        if (id === options.excludeId || seenIds.has(id)) {
            continue;
        }
        seenIds.add(id);
        matched.push({
            id,
            categoryId: String(categoryId),
            title: stream.title,
            posterUrl: recommendation.posterUrl ?? stream.posterUrl,
        });
    }

    return matched;
}
