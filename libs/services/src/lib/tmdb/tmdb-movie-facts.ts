import { TmdbMovieFacts } from '@iptvnator/shared/interfaces';
import { TmdbMovieDetails } from './tmdb.types';

const MAX_FACT_NAMES = 8;

function text(value: unknown): string | undefined {
    return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function names(values: (string | undefined)[]): string[] | undefined {
    const unique = new Map<string, string>();
    for (const value of values) {
        const name = text(value);
        if (name && !unique.has(name.toLowerCase())) {
            unique.set(name.toLowerCase(), name);
        }
        if (unique.size === MAX_FACT_NAMES) break;
    }
    return unique.size ? [...unique.values()] : undefined;
}

function amount(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : undefined;
}

function releaseDate(value: string | undefined): string | undefined {
    if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) {
        return undefined;
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    return !isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
        ? value
        : undefined;
}

/** Derives facts from the existing detail/credit payload without a lookup. */
export function movieFactsFromTmdb(
    details: TmdbMovieDetails
): TmdbMovieFacts | undefined {
    if (!Number.isSafeInteger(details.id) || details.id <= 0) return undefined;
    const crew = details.credits?.crew ?? [];
    const language = text(details.original_language)?.toLowerCase();
    const candidates: Omit<TmdbMovieFacts, 'tmdbId'> = {
        originalTitle: text(details.original_title),
        originalLanguage:
            language && /^[a-z]{2}$/.test(language) && language !== 'xx'
                ? language
                : undefined,
        releaseDate: releaseDate(details.release_date),
        budget: amount(details.budget),
        revenue: amount(details.revenue),
        collectionName: text(details.belongs_to_collection?.name),
        productionCompanies: names(
            (details.production_companies ?? []).map((company) => company.name)
        ),
        screenplayBy: names(
            crew
                .filter((person) => person.job === 'Screenplay')
                .map((p) => p.name)
        ),
        musicBy: names(
            crew
                .filter((person) => person.job === 'Original Music Composer')
                .map((person) => person.name)
        ),
    };
    const facts: TmdbMovieFacts = { tmdbId: details.id };
    // Keep unknown fields absent without requiring newer ES library globals.
    for (const key of Object.keys(candidates) as (keyof typeof candidates)[]) {
        const value = candidates[key];
        if (value !== undefined) Object.assign(facts, { [key]: value });
    }
    return Object.keys(facts).length > 1 ? facts : undefined;
}
