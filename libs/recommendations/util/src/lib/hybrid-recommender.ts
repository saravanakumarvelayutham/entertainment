export interface TasteAffinity {
    readonly key: string;
    readonly label: string;
    readonly weight: number;
}

export interface HybridRecommendationCandidate<T> {
    readonly id: string;
    readonly value: T;
    readonly affinityKeys: readonly string[];
    readonly sourceRank: number;
    readonly rating: number | null;
    readonly voteCount: number;
    readonly popularity: number;
    readonly year: number | null;
    readonly mediaType: 'movie' | 'tv';
}

export interface RankedHybridRecommendation<T> {
    readonly value: T;
    readonly score: number;
    readonly reasons: readonly string[];
}

export interface HybridRecommendationOptions {
    readonly limit: number;
    readonly currentYear?: number;
    readonly diversity?: number;
}

interface ScoredCandidate<T> extends HybridRecommendationCandidate<T> {
    readonly baseScore: number;
    readonly reasons: readonly string[];
    readonly stableIndex: number;
}

const clamp = (value: number, minimum = 0, maximum = 1): number =>
    Number.isFinite(value)
        ? Math.min(maximum, Math.max(minimum, value))
        : minimum;

const finiteOrZero = (value: number): number =>
    Number.isFinite(value) ? value : 0;

function normalizedAffinities(
    affinities: readonly TasteAffinity[]
): ReadonlyMap<string, TasteAffinity> {
    const valid = affinities.filter(
        ({ key, weight }) => key !== '' && Number.isFinite(weight) && weight > 0
    );
    const strongest = Math.max(0, ...valid.map(({ weight }) => weight));
    return new Map(
        valid.map((affinity) => [
            affinity.key,
            {
                ...affinity,
                weight: strongest > 0 ? affinity.weight / strongest : 0,
            },
        ])
    );
}

function scoreCandidate<T>(
    candidate: HybridRecommendationCandidate<T>,
    affinities: ReadonlyMap<string, TasteAffinity>,
    currentYear: number,
    stableIndex: number
): ScoredCandidate<T> {
    const matches = candidate.affinityKeys
        .map((key) => affinities.get(key))
        .filter((entry): entry is TasteAffinity => !!entry)
        .sort((left, right) => right.weight - left.weight);
    const affinity = matches.reduce((sum, entry) => sum + entry.weight, 0);
    const rating = clamp(finiteOrZero(candidate.rating ?? 0) / 10);
    const confidence = clamp(
        Math.log1p(Math.max(0, finiteOrZero(candidate.voteCount))) /
            Math.log(1001)
    );
    const quality = rating * (0.35 + confidence * 0.65);
    const popularity = clamp(
        Math.log1p(Math.max(0, finiteOrZero(candidate.popularity))) /
            Math.log(1001)
    );
    const freshness = candidate.year
        ? clamp(1 - Math.max(0, currentYear - candidate.year) / 30)
        : 0;
    const source =
        1 / Math.sqrt(Math.max(0, finiteOrZero(candidate.sourceRank)) + 1);

    return {
        ...candidate,
        stableIndex,
        reasons: [...new Set(matches.map(({ label }) => label))].slice(0, 2),
        baseScore:
            affinity * 6 +
            source * 2.25 +
            quality * 1.5 +
            popularity +
            freshness * 0.5,
    };
}

function similarity<T>(
    candidate: ScoredCandidate<T>,
    selected: readonly ScoredCandidate<T>[]
): number {
    if (selected.length === 0) return 0;
    const features = new Set(candidate.affinityKeys);
    const decade = candidate.year ? Math.floor(candidate.year / 10) : null;
    return Math.max(
        ...selected.map((item) => {
            const other = new Set(item.affinityKeys);
            const intersection = [...features].filter((key) => other.has(key));
            const union = new Set([...features, ...other]);
            const affinityOverlap =
                union.size > 0 ? intersection.length / union.size : 0;
            const mediaOverlap =
                item.mediaType === candidate.mediaType ? 0.15 : 0;
            const decadeOverlap =
                decade !== null &&
                item.year &&
                Math.floor(item.year / 10) === decade
                    ? 0.1
                    : 0;
            return clamp(affinityOverlap + mediaOverlap + decadeOverlap);
        })
    );
}

/**
 * Ranks local candidates using implicit taste affinities, TMDB quality and
 * freshness, then greedily trades a bounded amount of relevance for variety.
 */
export function rankHybridRecommendations<T>(
    affinities: readonly TasteAffinity[],
    candidates: readonly HybridRecommendationCandidate<T>[],
    options: HybridRecommendationOptions
): RankedHybridRecommendation<T>[] {
    if (options.limit <= 0 || candidates.length === 0) return [];
    const currentYear = options.currentYear ?? new Date().getUTCFullYear();
    const diversity = clamp(options.diversity ?? 0.22, 0, 0.75);
    const profile = normalizedAffinities(affinities);
    const remaining = candidates.map((candidate, index) =>
        scoreCandidate(candidate, profile, currentYear, index)
    );
    const selected: ScoredCandidate<T>[] = [];

    while (remaining.length > 0 && selected.length < options.limit) {
        remaining.sort((left, right) => {
            const leftScore =
                left.baseScore - similarity(left, selected) * diversity * 6;
            const rightScore =
                right.baseScore - similarity(right, selected) * diversity * 6;
            return (
                rightScore - leftScore || left.stableIndex - right.stableIndex
            );
        });
        const next = remaining.shift();
        if (next) selected.push(next);
    }

    return selected.map(({ value, baseScore, reasons }) => ({
        value,
        score: baseScore,
        reasons,
    }));
}
