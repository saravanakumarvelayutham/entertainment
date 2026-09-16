import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService } from '@iptvnator/services';

export type RecommendationFeedbackChoice = 'more-like-this' | 'not-for-me';

export interface RecommendationFeedbackTarget {
    readonly mediaType: 'movie' | 'tv';
    readonly tmdbId: number;
    readonly genreIds: readonly number[];
}

export interface RecommendationFeedbackEntry extends RecommendationFeedbackTarget {
    readonly choice: RecommendationFeedbackChoice;
    readonly updatedAt: string;
}

const STORAGE_KEY = 'recommendations:feedback:v1';
const MAX_ENTRIES = 2_000;

const feedbackKey = (
    target: Pick<RecommendationFeedbackTarget, 'mediaType' | 'tmdbId'>
): string => `${target.mediaType}:${target.tmdbId}`;

/** Local, account-free recommendation feedback persisted with app state. */
@Injectable({ providedIn: 'root' })
export class RecommendationFeedbackService {
    private readonly database = inject(DatabaseService);
    private loaded = false;
    private loadPromise: Promise<void> | null = null;
    private mutationQueue: Promise<void> = Promise.resolve();

    readonly entries = signal<readonly RecommendationFeedbackEntry[]>([]);

    async load(): Promise<void> {
        if (this.loaded) return;
        if (this.loadPromise) return this.loadPromise;

        const promise = this.loadPersistedFeedback();
        this.loadPromise = promise;
        try {
            await promise;
            this.loaded = true;
        } finally {
            if (this.loadPromise === promise) this.loadPromise = null;
        }
    }

    choiceFor(
        target: Pick<RecommendationFeedbackTarget, 'mediaType' | 'tmdbId'>
    ): RecommendationFeedbackChoice | null {
        const key = feedbackKey(target);
        return (
            this.entries().find((entry) => feedbackKey(entry) === key)
                ?.choice ?? null
        );
    }

    isDismissed(
        target: Pick<RecommendationFeedbackTarget, 'mediaType' | 'tmdbId'>
    ): boolean {
        return this.choiceFor(target) === 'not-for-me';
    }

    affinityWeights(): ReadonlyMap<string, number> {
        const weights = new Map<string, number>();
        for (const entry of this.entries()) {
            if (entry.choice !== 'more-like-this') continue;
            for (const genreId of entry.genreIds) {
                const key = `${entry.mediaType}:genre:${genreId}`;
                weights.set(key, (weights.get(key) ?? 0) + 20);
            }
        }
        return weights;
    }

    cacheKey(): string {
        return this.entries()
            .map(
                (entry) =>
                    `${feedbackKey(entry)}:${entry.choice}:${entry.genreIds.join(',')}`
            )
            .sort()
            .join('|');
    }

    setFeedback(
        target: RecommendationFeedbackTarget,
        choice: RecommendationFeedbackChoice | null
    ): Promise<void> {
        const operation = this.mutationQueue.then(async () => {
            await this.load();
            const key = feedbackKey(target);
            const next = this.entries().filter(
                (entry) => feedbackKey(entry) !== key
            );
            if (choice) {
                next.unshift({
                    ...target,
                    genreIds: [...new Set(target.genreIds)].filter(
                        (id) => Number.isInteger(id) && id > 0
                    ),
                    choice,
                    updatedAt: new Date().toISOString(),
                });
            }
            const bounded = next.slice(0, MAX_ENTRIES);
            const saved = await this.database.setAppState(
                STORAGE_KEY,
                JSON.stringify({ entries: bounded })
            );
            if (!saved)
                throw new Error(
                    'SaravTV could not save recommendation feedback.'
                );
            this.entries.set(bounded);
        });
        this.mutationQueue = operation.catch(() => undefined);
        return operation;
    }

    private async loadPersistedFeedback(): Promise<void> {
        const value = await this.database.getAppStateOrThrow(STORAGE_KEY);
        if (!value) return;
        try {
            const parsed = JSON.parse(value) as { entries?: unknown };
            if (!Array.isArray(parsed.entries)) return;
            const deduped = new Map<string, RecommendationFeedbackEntry>();
            for (const value of parsed.entries) {
                if (!this.isEntry(value)) continue;
                const key = feedbackKey(value);
                if (!deduped.has(key)) deduped.set(key, value);
                if (deduped.size === MAX_ENTRIES) break;
            }
            this.entries.set([...deduped.values()]);
        } catch {
            // A malformed local value must not prevent the dashboard loading.
        }
    }

    private isEntry(value: unknown): value is RecommendationFeedbackEntry {
        if (!value || typeof value !== 'object') return false;
        const entry = value as RecommendationFeedbackEntry;
        return (
            (entry.mediaType === 'movie' || entry.mediaType === 'tv') &&
            Number.isInteger(entry.tmdbId) &&
            entry.tmdbId > 0 &&
            Array.isArray(entry.genreIds) &&
            entry.genreIds.every(
                (id) => Number.isInteger(id) && (id as number) > 0
            ) &&
            (entry.choice === 'more-like-this' ||
                entry.choice === 'not-for-me') &&
            typeof entry.updatedAt === 'string'
        );
    }
}
