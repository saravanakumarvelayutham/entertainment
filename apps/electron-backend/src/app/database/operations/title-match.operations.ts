import { sql } from 'drizzle-orm';
import {
    CatalogTitleMatch,
    bracketedReleaseYear,
    normalizeTitleKeys,
} from '@iptvnator/shared/interfaces';
import type { AppDatabase } from '../database.types';

/**
 * Batched cross-playlist title matching for the actor page's "All portals"
 * scope. For every requested title one trigram-FTS lookup runs against
 * `content_title_fts`. Confirmation is two-tier, mirroring the renderer's
 * portal-scoped matching: the query (a canonical TMDB title) must equal
 * either the candidate's exact normalized title, or its year-stripped form
 * — in which case the stripped year tag is returned so the renderer can
 * reject year-incompatible matches.
 *
 * A matching title is not yet a matching FILM. "Dune (1984)" and "Dune
 * (2021)" normalize to the same exact key, so every row also reports the
 * year it states (bracketed tag, or the back-filled `release_year`) and the
 * TMDB id it already carries; the renderer's `pickTitleMatch` rejects a row
 * that contradicts the lookup on either. Without that, a dashboard card
 * wearing the 2021 poster opened the 1984 film.
 */

const MAX_TITLES_PER_REQUEST = 200;
const PER_TITLE_CANDIDATE_LIMIT = 24;

interface TitleMatchRow {
    title: string;
    xtream_id: number;
    type: 'movie' | 'series';
    category_xtream_id: number;
    playlist_id: string;
    playlist_name: string;
    release_year: number | null;
    tmdb_id: number | null;
}

/** A stored integer id/year, or null for SQL NULL and legacy junk. */
function positiveIntegerOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
        ? value
        : null;
}

function buildFtsMatchQuery(normalizedTitle: string): string {
    const tokens = normalizedTitle
        .split(' ')
        // The trigram tokenizer cannot match tokens shorter than 3 chars
        .filter((token) => token.length >= 3)
        .map((token) => `"${token.replace(/"/g, '""')}"`);
    return tokens.join(' AND ');
}

export async function matchTitles(
    db: AppDatabase,
    titles: string[]
): Promise<CatalogTitleMatch[]> {
    const uniqueTitles = [
        ...new Set(
            (titles ?? []).filter(
                (title) => typeof title === 'string' && title.trim() !== ''
            )
        ),
    ].slice(0, MAX_TITLES_PER_REQUEST);

    const matches: CatalogTitleMatch[] = [];

    for (const queryTitle of uniqueTitles) {
        // TMDB titles are canonical — a trailing year is part of the title
        const wanted = normalizeTitleKeys(queryTitle).exact;
        const matchQuery = buildFtsMatchQuery(wanted);
        if (!wanted || !matchQuery) {
            continue;
        }

        let rows: TitleMatchRow[];
        try {
            rows = (await db.all(sql`
                SELECT
                    c.title AS title,
                    c.xtream_id AS xtream_id,
                    c.type AS type,
                    cat.xtream_id AS category_xtream_id,
                    cat.playlist_id AS playlist_id,
                    p.name AS playlist_name,
                    c.release_year AS release_year,
                    c.tmdb_id AS tmdb_id
                FROM content_title_fts
                INNER JOIN content AS c ON c.id = content_title_fts.rowid
                INNER JOIN categories AS cat ON c.category_id = cat.id
                INNER JOIN playlists AS p ON cat.playlist_id = p.id
                WHERE content_title_fts MATCH ${matchQuery}
                AND c.type IN ('movie', 'series')
                AND cat.hidden = 0
                ORDER BY rank, c.title
                LIMIT ${PER_TITLE_CANDIDATE_LIMIT}
            `)) as TitleMatchRow[];
        } catch {
            // Malformed FTS query for exotic titles — skip, don't fail the batch
            continue;
        }

        for (const row of rows) {
            const rowKeys = normalizeTitleKeys(row.title);
            const exactMatch = rowKeys.exact === wanted;
            const baseMatch =
                !exactMatch &&
                rowKeys.base !== rowKeys.exact &&
                rowKeys.base === wanted;
            if (!exactMatch && !baseMatch) {
                continue;
            }
            // On the exact tier a trailing number is part of the NAME (the
            // query has it too), so only a bracketed tag or the stored
            // provider year can say which same-titled film this row is.
            const statedYear =
                (exactMatch ? null : rowKeys.trailingYear) ??
                bracketedReleaseYear(row.title) ??
                positiveIntegerOrNull(row.release_year);
            matches.push({
                queryTitle,
                playlistId: row.playlist_id,
                playlistName: row.playlist_name,
                categoryId: row.category_xtream_id,
                xtreamId: row.xtream_id,
                type: row.type,
                trailingYear: statedYear,
                tmdbId: positiveIntegerOrNull(row.tmdb_id),
            });
        }
    }

    return matches;
}
