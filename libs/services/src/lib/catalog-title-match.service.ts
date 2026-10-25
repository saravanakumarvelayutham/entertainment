import { Injectable } from '@angular/core';
import {
    CatalogTitleMatch,
    normalizeTitleKeys,
    titleYearsCompatible,
} from '@iptvnator/shared/interfaces';

/** What one caller is looking for, in catalog-match terms */
export interface CatalogTitleLookup {
    readonly type: 'movie' | 'series';
    /**
     * Title aliases to try, most-trusted first. Usually a single title; a
     * caller that also knows an original-language title passes it second,
     * since a catalog often names an item in its original language while
     * the app language localizes the TMDB title.
     */
    readonly titles: readonly string[];
    /** Release year, or null when unknown. TMDB cards require release evidence. */
    readonly year: number | null;
    /**
     * The lookup's own TMDB id when the caller has one. A row that already
     * carries a DIFFERENT id is a different film however its title reads,
     * and a row carrying the SAME id outranks every title-only match.
     */
    readonly tmdbId?: number | null;
}

/**
 * EVERY match per `type:exactNormalizedTitle`, in the order the worker
 * returned them.
 *
 * Deliberately not collapsed to one row per key: the year that decides
 * between same-titled rows belongs to the LOOKUP, which this function
 * cannot see. A catalog holding both "Dune 1984" and "Dune 2021" would
 * otherwise keep whichever arrived first, and a 2021 lookup would then
 * fail its year check with the right row already discarded — rendering
 * as "not in your library" for a movie the library does hold.
 */
export function groupTitleMatchesByKey(
    matches: readonly CatalogTitleMatch[]
): Map<string, CatalogTitleMatch[]> {
    const grouped = new Map<string, CatalogTitleMatch[]>();
    for (const match of matches) {
        const key = `${match.type}:${normalizeTitleKeys(match.queryTitle).exact}`;
        const rows = grouped.get(key);
        if (rows) {
            rows.push(match);
        } else {
            grouped.set(key, [match]);
        }
    }
    return grouped;
}

/**
 * The catalog row this lookup should resolve to, or null.
 *
 * Aliases are tried in order, but ranking is by EVIDENCE across all of
 * them at once — a bad hit under the first alias must not veto a good one
 * under the second. A row whose stripped year IS the lookup's wins: that
 * is positive evidence for this exact film, while an untagged row merely
 * fails to contradict one ("Dune" could be either cut, so resolving a
 * 2021 lookup to it when "Dune 2021" also exists throws better evidence
 * away). TMDB-backed lookups require a matching ID or a compatible known
 * year on both sides; an untagged title alone cannot prove availability.
 * Without a lookup ID, untagged rows remain a title-search fallback.
 * Alias order survives as the tiebreaker within a tier.
 *
 * Identity beats title: a row whose stored TMDB id IS the lookup's wins
 * outright, and a row naming a different id is dropped before any tier,
 * since two films can share a normalized title but never a TMDB id.
 */
export function pickTitleMatch(
    lookup: CatalogTitleLookup,
    grouped: ReadonlyMap<string, CatalogTitleMatch[]>
): CatalogTitleMatch | null {
    const candidates: CatalogTitleMatch[] = [];
    const seenKeys = new Set<string>();
    for (const title of lookup.titles) {
        const key = `${lookup.type}:${normalizeTitleKeys(title).exact}`;
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            candidates.push(...(grouped.get(key) ?? []));
        }
    }
    return pickTitleMatchCandidate(lookup, candidates);
}

/** Shared identity ranking for worker matches and the loaded portal catalog. */
export function pickTitleMatchCandidate<
    T extends Pick<CatalogTitleMatch, 'trailingYear' | 'tmdbId'>,
>(
    lookup: Pick<CatalogTitleLookup, 'year' | 'tmdbId'>,
    candidates: readonly T[]
): T | null {
    const lookupTmdbId =
        typeof lookup.tmdbId === 'number' && lookup.tmdbId > 0
            ? lookup.tmdbId
            : null;
    const compatible: T[] = [];
    for (const row of candidates) {
        const rowTmdbId = row.tmdbId ?? null;
        if (
            lookupTmdbId !== null &&
            rowTmdbId !== null &&
            rowTmdbId !== lookupTmdbId
        ) {
            continue;
        }
        if (lookupTmdbId !== null && rowTmdbId === lookupTmdbId) {
            return row;
        }
        // A TMDB card identifies a particular release. An untagged provider
        // title is only a search candidate, even if it is the sole hit.
        if (
            lookupTmdbId !== null &&
            (lookup.year === null || row.trailingYear === null)
        ) {
            continue;
        }
        if (titleYearsCompatible(lookup.year, row.trailingYear)) {
            compatible.push(row);
        }
    }

    return (
        (lookup.year !== null
            ? compatible.find((row) => row.trailingYear === lookup.year)
            : undefined) ??
        compatible.find((row) => row.trailingYear === null) ??
        compatible[0] ??
        null
    );
}

/**
 * Cross-playlist title matching via the Electron DB worker
 * (`DB_MATCH_TITLES`, trigram FTS over all imported Xtream playlists).
 * Unavailable in the PWA — `isAvailable` gates the actor page's
 * "All portals" scope.
 */
@Injectable({ providedIn: 'root' })
export class CatalogTitleMatchService {
    get isAvailable(): boolean {
        return (
            typeof window !== 'undefined' &&
            typeof window.electron?.dbMatchTitles === 'function'
        );
    }

    async matchTitles(titles: string[]): Promise<CatalogTitleMatch[]> {
        if (!this.isAvailable || titles.length === 0) {
            return [];
        }

        try {
            return await window.electron.dbMatchTitles(titles);
        } catch (error) {
            console.warn('Cross-playlist title matching failed:', error);
            return [];
        }
    }
}
