import { Injectable, signal } from '@angular/core';
import {
    MAX_AI_RECOMMENDATION_CANDIDATES,
    normalizeAiRecommendationSettings,
    type AiRecommendationSettings,
} from '@iptvnator/shared/interfaces';
import type { DashboardRecommendationItem } from './dashboard-recommendations.util';

export interface DashboardAiRecommendation {
    item: DashboardRecommendationItem;
    reason: string;
}

interface AiLoad {
    key: string;
    settings: AiRecommendationSettings;
    candidates: readonly DashboardRecommendationItem[];
}

const candidateId = (item: DashboardRecommendationItem): string =>
    `${item.mediaType}:${item.tmdbId}`;

/** Only explicit taste text and public candidate metadata cross the bridge.
 * Watch history, source identities, URLs and credentials stay in the app. */
@Injectable({ providedIn: 'root' })
export class DashboardAiRecommendationsService {
    readonly items = signal<readonly DashboardAiRecommendation[]>([]);
    readonly loading = signal(false);
    readonly failed = signal(false);
    private desired: AiLoad | null = null;
    private active = false;
    private attemptedKey: string | null = null;
    private readonly cache = new Map<
        string,
        readonly DashboardAiRecommendation[]
    >();

    refresh(
        settings: unknown,
        pool: readonly DashboardRecommendationItem[],
        retry = false
    ): void {
        const config = normalizeAiRecommendationSettings(settings);
        const seen = new Set<string>();
        const candidates = pool
            .filter((item) => {
                const id = candidateId(item);
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
            })
            .slice(0, MAX_AI_RECOMMENDATION_CANDIDATES);
        if (
            !config.enabled ||
            !config.preferences ||
            !config.model ||
            candidates.length === 0 ||
            !window.electron?.rankAiRecommendations
        ) {
            this.desired = null;
            this.attemptedKey = null;
            this.items.set([]);
            this.loading.set(false);
            this.failed.set(false);
            return;
        }
        const key = JSON.stringify({ config, candidates });
        if (!retry && this.desired?.key === key && this.attemptedKey === key)
            return;
        this.desired = { key, settings: config, candidates };
        this.items.set([]);
        this.failed.set(false);
        if (!retry && this.cache.has(key)) {
            this.attemptedKey = key;
            this.items.set(this.cache.get(key) ?? []);
            this.loading.set(false);
            return;
        }
        this.loading.set(true);
        if (retry) this.attemptedKey = null;
        if (!this.active) void this.run();
    }

    private async run(): Promise<void> {
        this.active = true;
        try {
            while (this.desired && this.attemptedKey !== this.desired.key) {
                const load = this.desired;
                this.attemptedKey = load.key;
                try {
                    const response =
                        await window.electron.rankAiRecommendations({
                            model: load.settings.model,
                            preferences: load.settings.preferences,
                            candidates: load.candidates.map((item) => ({
                                id: candidateId(item),
                                title: item.title,
                                year: item.year,
                                mediaType: item.mediaType,
                                genreIds: item.genreIds,
                            })),
                        });
                    if (this.desired?.key !== load.key) continue;
                    const byId = new Map(
                        load.candidates.map((item) => [candidateId(item), item])
                    );
                    const seen = new Set<string>();
                    const ranked: DashboardAiRecommendation[] = [];
                    for (const { id, reason } of response.ranked) {
                        const item = byId.get(id);
                        if (!item || seen.has(id) || typeof reason !== 'string')
                            continue;
                        seen.add(id);
                        ranked.push({ item, reason });
                    }
                    if (ranked.length === 0)
                        throw new Error('No valid AI picks');
                    this.items.set(ranked.slice(0, 20));
                    this.cache.set(load.key, this.items());
                    if (this.cache.size > 8)
                        this.cache.delete(
                            this.cache.keys().next().value as string
                        );
                    this.failed.set(false);
                } catch {
                    if (this.desired?.key === load.key) {
                        this.items.set([]);
                        this.failed.set(true);
                    }
                }
            }
        } finally {
            this.active = false;
            this.loading.set(false);
        }
    }
}
