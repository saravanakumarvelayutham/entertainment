import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService } from '@iptvnator/services';
import {
    MAX_AI_RECOMMENDATION_CANDIDATES,
    normalizeAiRecommendationSettings,
    MAX_AI_TASTE_SUMMARY_LENGTH,
    type AiRecommendationSettings,
    type AiRecommendationTasteSignals,
    type AiRecommendationErrorCode,
} from '@iptvnator/shared/interfaces';
import type { DashboardRecommendationItem } from './dashboard-recommendations.util';
import { hasDashboardAiTasteSignals } from './dashboard-ai-taste-signals.util';
import {
    DashboardAiResultCache,
    dashboardAiResultKey,
} from './dashboard-ai-result-cache';
import { DashboardAiTasteProfile } from './dashboard-ai-taste-profile';
import {
    dashboardAiEvidenceKey,
    dashboardAiErrorCode,
    emptyDashboardAiDiscoveryHints,
    type DashboardAiDiscoveryHints,
} from './dashboard-ai-response.util';
export type { DashboardAiDiscoveryHints } from './dashboard-ai-response.util';
export { dashboardAiEvidenceKey } from './dashboard-ai-response.util';

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
    retry: boolean;
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
    readonly errorCode = signal<AiRecommendationErrorCode | null>(null);
    readonly discoveryHints = signal<DashboardAiDiscoveryHints>(
        emptyDashboardAiDiscoveryHints()
    );
    readonly discoveryEvidenceKey = signal<string | null>(null);
    readonly tasteSummary = signal<string | null>(null);
    readonly profilePersistenceFailed = signal(false);
    private readonly profile = new DashboardAiTasteProfile(
        inject(DatabaseService)
    );
    private profileFingerprint: string | null = null;
    private desired: AiLoad | null = null;
    private active = false;
    private attemptedKey: string | null = null;
    readonly resultCachePersistenceFailed = signal(false);
    private readonly cache = new DashboardAiResultCache(
        inject(DatabaseService)
    );

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
        const fingerprint = dashboardAiEvidenceKey(config, tasteSignals);
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
            this.errorCode.set(null);
            this.discoveryHints.set(emptyDashboardAiDiscoveryHints());
            this.discoveryEvidenceKey.set(null);
            if (!config.enabled) this.tasteSummary.set(null);
            return;
        }
        const key = dashboardAiResultKey(config, candidates, tasteSignals);
        if (
            !retry &&
            this.desired?.key === key &&
            this.attemptedKey === key &&
            (this.active || this.failed() || this.cache.peek(key))
        ) {
            this.desired = { ...this.desired, candidates };
            const byId = new Map(
                candidates.map((item) => [candidateId(item), item])
            );
            const current = this.items();
            if (
                current.some(
                    ({ item }) =>
                        JSON.stringify(item.match) !==
                        JSON.stringify(byId.get(candidateId(item))?.match)
                )
            ) {
                this.items.set(
                    current.map(({ item, reason }) => ({
                        item: byId.get(candidateId(item)) ?? item,
                        reason,
                    }))
                );
            }
            return;
        }
        this.desired = {
            key,
            settings: config,
            candidates,
            tasteSignals,
            fingerprint,
            retry,
        };
        this.items.set([]);
        this.failed.set(false);
        this.errorCode.set(null);
        this.discoveryHints.set(emptyDashboardAiDiscoveryHints());
        this.discoveryEvidenceKey.set(null);
        const cached = !retry ? this.cache.peek(key) : null;
        const byId = new Map(
            candidates.map((item) => [candidateId(item), item])
        );
        if (
            cached &&
            cached.ranked.every(({ id }) => byId.has(id)) &&
            (!candidates.length || cached.ranked.length) &&
            (!tasteSignals || cached.tasteSummary)
        ) {
            this.attemptedKey = key;
            this.items.set(
                cached.ranked.map(({ id, reason }) => ({
                    item: byId.get(id) as DashboardRecommendationItem,
                    reason,
                }))
            );
            this.discoveryEvidenceKey.set(fingerprint);
            this.tasteSummary.set(cached.tasteSummary ?? null);
            this.discoveryHints.set({
                suggestedTitles: cached.suggestedTitles ?? [],
                discoveryGenres: cached.discoveryGenres ?? [],
            });
            if (cached.tasteSummary)
                void this.restoreProfileIfMissing(
                    this.desired,
                    cached.tasteSummary
                );
            this.loading.set(false);
            return;
        }
        this.loading.set(true);
        this.attemptedKey = null;
        if (!this.active) void this.run();
    }

    private async run(): Promise<void> {
        this.active = true;
        try {
            while (this.desired && this.attemptedKey !== this.desired.key) {
                const load = this.desired;
                this.attemptedKey = load.key;
                try {
                    const cached = !load.retry
                        ? await this.cache.read(load.key).catch(() => {
                              if (this.desired?.key === load.key)
                                  this.resultCachePersistenceFailed.set(true);
                              return null;
                          })
                        : null;
                    const ids = new Set(load.candidates.map(candidateId));
                    const usableCache =
                        cached &&
                        cached.ranked.every((item) => ids.has(item.id)) &&
                        (!load.candidates.length || cached.ranked.length > 0) &&
                        (!load.tasteSignals || cached.tasteSummary);
                    const priorTasteSummary =
                        load.settings.learnFromHistory && !usableCache
                            ? await this.profile.readLatest().catch(() => {
                                  if (this.desired?.key === load.key)
                                      this.profilePersistenceFailed.set(true);
                                  return null;
                              })
                            : null;
                    if (this.desired?.key !== load.key) continue;
                    const response = usableCache
                        ? cached
                        : await window.electron.rankAiRecommendations({
                              model: load.settings.model,
                              preferences: load.settings.preferences,
                              ...(priorTasteSummary
                                  ? { priorTasteSummary }
                                  : {}),
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
                        (this.desired?.candidates ?? load.candidates).map(
                            (item) => [candidateId(item), item]
                        )
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
                        throw new Error(
                            '[ai-recommendations:invalid-response]'
                        );
                    const summary = response.tasteSummary;
                    if (
                        summary !== undefined &&
                        (typeof summary !== 'string' ||
                            !summary.trim() ||
                            summary.length > MAX_AI_TASTE_SUMMARY_LENGTH)
                    )
                        throw new Error(
                            '[ai-recommendations:invalid-response]'
                        );
                    if (load.tasteSignals && !summary)
                        throw new Error(
                            '[ai-recommendations:invalid-response]'
                        );
                    const hints: DashboardAiDiscoveryHints = {
                        suggestedTitles: response.suggestedTitles ?? [],
                        discoveryGenres: response.discoveryGenres ?? [],
                    };
                    this.discoveryEvidenceKey.set(load.fingerprint);
                    this.discoveryHints.set(hints);
                    this.items.set(ranked.slice(0, 20));
                    this.failed.set(false);
                    if (summary) {
                        this.tasteSummary.set(summary.trim());
                        if (usableCache)
                            await this.restoreProfileIfMissing(
                                load,
                                summary.trim()
                            );
                        else await this.persistProfile(load, summary.trim());
                    }
                    if (!usableCache) {
                        await this.cache
                            .save(load.key, {
                                ranked: ranked
                                    .slice(0, 20)
                                    .map(({ item, reason }) => ({
                                        id: candidateId(item),
                                        reason,
                                    })),
                                ...(summary
                                    ? { tasteSummary: summary.trim() }
                                    : {}),
                                ...hints,
                            })
                            .then(() => {
                                if (this.desired?.key === load.key)
                                    this.resultCachePersistenceFailed.set(
                                        false
                                    );
                            })
                            .catch(() => {
                                if (this.desired?.key === load.key)
                                    this.resultCachePersistenceFailed.set(true);
                            });
                    }
                } catch (error: unknown) {
                    if (this.desired?.key === load.key) {
                        this.items.set([]);
                        this.failed.set(true);
                        this.errorCode.set(dashboardAiErrorCode(error));
                        this.discoveryHints.set(
                            emptyDashboardAiDiscoveryHints()
                        );
                        this.discoveryEvidenceKey.set(null);
                    }
                }
            }
        } finally {
            this.active = false;
            this.loading.set(false);
        }
    }

    private async restoreProfileIfMissing(
        load: AiLoad,
        summary: string
    ): Promise<void> {
        const latest = await this.profile.readLatest().catch(() => null);
        if (!latest) await this.persistProfile(load, summary);
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
    async retrySaveResults(): Promise<void> {
        const key = this.desired?.key;
        if (!key) return;
        const response = this.cache.peek(key);
        if (!response) return;
        try {
            await this.cache.save(key, response);
            if (this.desired?.key === key)
                this.resultCachePersistenceFailed.set(false);
        } catch {
            if (this.desired?.key === key)
                this.resultCachePersistenceFailed.set(true);
        }
    }
}
