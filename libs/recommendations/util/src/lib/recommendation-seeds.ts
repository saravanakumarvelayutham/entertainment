export interface BalancedRecommendationSeedOptions<T> {
    readonly limit: number;
    readonly key: (seed: T) => string;
}

/**
 * Selects distinct seeds round-robin across independently ranked sources.
 * Each source keeps its own ordering, while no non-empty source can be
 * starved merely because another source contains more entries.
 */
export function selectBalancedRecommendationSeeds<T>(
    groups: readonly (readonly T[])[],
    options: BalancedRecommendationSeedOptions<T>
): T[] {
    if (options.limit <= 0 || groups.length === 0) return [];

    const selected: T[] = [];
    const seen = new Set<string>();
    const indexes = groups.map(() => 0);

    while (selected.length < options.limit) {
        let advanced = false;
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
            const group = groups[groupIndex];
            while (indexes[groupIndex] < group.length) {
                const seed = group[indexes[groupIndex]++];
                advanced = true;
                const key = options.key(seed);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                selected.push(seed);
                break;
            }
            if (selected.length === options.limit) return selected;
        }
        if (!advanced) break;
    }

    return selected;
}
