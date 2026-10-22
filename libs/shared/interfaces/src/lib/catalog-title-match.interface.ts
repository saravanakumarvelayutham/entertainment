/**
 * One confident cross-playlist title match returned by the Electron DB
 * worker (`DB_MATCH_TITLES`). Used by the actor page's "All portals"
 * scope: matching runs over the trigram FTS index of the `content` table
 * (Xtream playlists only — Stalker content is never imported).
 */
export interface CatalogTitleMatch {
    /** The title from the request this row matched (verbatim) */
    queryTitle: string;
    playlistId: string;
    playlistName: string;
    /** Xtream category id (route param for detail navigation) */
    categoryId: number;
    xtreamId: number;
    type: 'movie' | 'series';
    /**
     * The release year the catalog ROW states, or null when it states none.
     *
     * Three sources, in order: the year tag stripped on the year-stripped
     * tier ("The Matrix 1999" matching the query "The Matrix"); a bracketed
     * tag on either tier ("Dune (1984)" normalizes to exactly "dune", so
     * the exact tier alone cannot tell it from "Dune (2021)"); and the
     * provider-stated `release_year` a detail view back-filled onto the
     * row. On the exact tier a bare trailing number is never read as a
     * year — the query carries it too, so it is part of the NAME ("Blade
     * Runner 2049"). Consumers with a known query year must reject
     * incompatible years — this keeps "Blade Runner" from claiming a
     * catalog "Blade Runner 2049", and a 2021 "Dune" card from opening
     * the 1984 film.
     */
    trailingYear: number | null;
    /**
     * The TMDB id the row already carries (back-filled by a detail view
     * that enriched it), or null. Positive identity: a lookup that knows
     * its own TMDB id must never resolve to a row naming a different one,
     * whatever the titles say.
     */
    tmdbId: number | null;
}
