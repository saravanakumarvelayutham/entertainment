import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService } from '@iptvnator/services';
import {
    MAX_AI_RECOMMENDATION_CANDIDATES,
    normalizeAiRecommendationSettings,
    MAX_AI_TASTE_SUMMARY_LENGTH,
    type AiRecommendationSettings,
    type AiRecommendationTasteSignals,
} from '@iptvnator/shared/interfaces';
import type { DashboardRecommendationItem } from './dashboard-recommendations.util';
import { hasDashboardAiTasteSignals } from './dashboard-ai-taste-signals.util';
import { DashboardAiTasteProfile } from './dashboard-ai-taste-profile';

export interface DashboardAiRecommendation {
    item: DashboardRecommendationItem;
    reason: string;
}

interface AiLoad {
    key: string;
    settings: AiRecommendationSettings;
    candidates: readonly DashboardRecommendationItem[];
    tasteSignals?: AiRecommendationTasteSignals;
    fingerprint: string;
}

const candidateId = (item: DashboardRecommendationItem): string =>
    `${item.mediaType}:${item.tmdbId}`;

/** Explicit taste text and opt-in title/completion/vote signals cross the bridge.
 * Source identities, URLs, credentials and exact timestamps stay in the app. */
@Injectable({ providedIn: 'root' })
export class DashboardAiRecommendationsService {
    readonly items = signal<readonly DashboardAiRecommendation[]>([]);
    readonly loading = signal(false);
    readonly failed = signal(false);
    readonly tasteSummary = signal<string | null>(null);
    readonly profilePersistenceFailed = signal(false);
    private readonly profile = new DashboardAiTasteProfile(
        inject(DatabaseService)
    );
    private profileFingerprint: string | null = null;
    private desired: AiLoad | null = null;
    private active = false;
    private attemptedKey: string | null = null;
    private readonly cache = new Map<
        string,
        { items: readonly DashboardAiRecommendation[]; summary: string | null }
    >();

    refresh(
        settings: unknown,
        pool: readonly DashboardRecommendationItem[],
        retry = false,
        signals?: AiRecommendationTasteSignals
    ): void {
        const config = normalizeAiRecommendationSettings(settings);
        const tasteSignals =
            config.learnFromHistory && hasDashboardAiTasteSignals(signals)
                ? signals
                : undefined;
        const fingerprint = JSON.stringify({ config, tasteSignals });
        if (this.profileFingerprint !== fingerprint) {
            this.profileFingerprint = fingerprint;
            this.tasteSummary.set(null);
            this.profilePersistenceFailed.set(false);
            if (config.enabled && (config.preferences || tasteSignals)) {
                void this.profile
                    .read(fingerprint)
                    .then((summary) => {
                        if (
                            this.profileFingerprint === fingerprint &&
                            !this.tasteSummary()
                        )
                            this.tasteSummary.set(summary);
                    })
                    .catch(() => {
                        if (this.profileFingerprint === fingerprint)
                            this.profilePersistenceFailed.set(true);
                    });
            }
        }
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
            (!config.preferences && !tasteSignals) ||
            !config.model ||
            (candidates.length === 0 && !tasteSignals) ||
            !window.electron?.rankAiRecommendations
        ) {
            this.desired = null;
            this.attemptedKey = null;
            this.items.set([]);
            this.loading.set(false);
            this.failed.set(false);
            if (!config.enabled) this.tasteSummary.set(null);
            return;
        }
        const key = JSON.stringify({ config, candidates, tasteSignals });
        if (!retry && this.desired?.key === key && this.attemptedKey === key)
            return;
        this.desired = {
            key,
            settings: config,
            candidates,
            tasteSignals,
            fingerprint,
        };
        this.items.set([]);
        this.failed.set(false);
        if (!retry && this.cache.has(key)) {
            this.attemptedKey = key;
            const cached = this.cache.get(key);
            this.items.set(cached?.items ?? []);
            this.tasteSummary.set(cached?.summary ?? null);
            if (cached?.summary)
                void this.persistProfile(this.desired, cached.summary);
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
                            ...(load.tasteSignals
                                ? { tasteSignals: load.tasteSignals }
                                : {}),
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
                    if (ranked.length === 0 && load.candidates.length > 0)
                        throw new Error('No valid AI picks');
                    const summary = response.tasteSummary;
                    if (
                        summary !== undefined &&
                        (typeof summary !== 'string' ||
                            !summary.trim() ||
                            summary.length > MAX_AI_TASTE_SUMMARY_LENGTH)
                    )
                        throw new Error('Invalid AI taste profile');
                    if (load.tasteSignals && !summary)
                        throw new Error('Missing AI taste profile');
                    this.items.set(ranked.slice(0, 20));
                    this.cache.set(load.key, {
                        items: this.items(),
                        summary: summary?.trim() ?? null,
                    });
                    if (this.cache.size > 8)
                        this.cache.delete(
                            this.cache.keys().next().value as string
                        );
                    this.failed.set(false);
                    if (summary) {
                        this.tasteSummary.set(summary.trim());
                        await this.persistProfile(load, summary.trim());
                    }
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

    private async persistProfile(load: AiLoad, summary: string): Promise<void> {
        // Settle the initial read before writing, so it cannot overwrite a
        // newer response. Failed reads do not prevent a fresh profile save.
        await this.profile.read(load.fingerprint).catch(() => undefined);
        if (this.desired?.key !== load.key) return;
        try {
            await this.profile.save(load.fingerprint, summary);
            if (this.desired?.key === load.key)
                this.profilePersistenceFailed.set(false);
        } catch {
            if (this.desired?.key === load.key)
                this.profilePersistenceFailed.set(true);
        }
    }

    async retrySaveTasteProfile(): Promise<void> {
        const fingerprint = this.profileFingerprint;
        const summary = this.tasteSummary();
        if (!fingerprint || !summary) return;
        await this.profile.read(fingerprint).catch(() => undefined);
        if (this.profileFingerprint !== fingerprint) return;
        try {
            await this.profile.save(fingerprint, summary);
            if (this.profileFingerprint === fingerprint)
                this.profilePersistenceFailed.set(false);
        } catch {
            if (this.profileFingerprint === fingerprint)
                this.profilePersistenceFailed.set(true);
        }
    }
}
