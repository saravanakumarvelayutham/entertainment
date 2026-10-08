import {
    normalizeAiRecommendationSettings,
    type AiRecommendationTasteSignals,
    type AiRecommendationErrorCode,
    type AiRecommendationRankResponse,
} from '@iptvnator/shared/interfaces';

import { hasDashboardAiTasteSignals } from './dashboard-ai-taste-signals.util';

export function dashboardAiEvidenceKey(
    settings: unknown,
    signals?: AiRecommendationTasteSignals
): string {
    const config = normalizeAiRecommendationSettings(settings);
    const tasteSignals =
        config.learnFromHistory && hasDashboardAiTasteSignals(signals)
            ? signals
            : undefined;
    return JSON.stringify({
        config,
        tasteSignals: canonicalDashboardAiSignals(tasteSignals),
    });
}

export interface DashboardAiDiscoveryHints {
    suggestedTitles: NonNullable<
        AiRecommendationRankResponse['suggestedTitles']
    >;
    discoveryGenres: NonNullable<
        AiRecommendationRankResponse['discoveryGenres']
    >;
}

export function emptyDashboardAiDiscoveryHints(): DashboardAiDiscoveryHints {
    return { suggestedTitles: [], discoveryGenres: [] };
}

/** IPC errors may carry an Electron prefix; retain only the main-owned code. */
export function dashboardAiErrorCode(
    error: unknown
): AiRecommendationErrorCode {
    const message = error instanceof Error ? error.message : '';
    const code = message.match(
        /\[ai-recommendations:(missing-token|invalid-request|timeout|network|auth|rate-limit|unavailable|invalid-response|response-too-large)\]\s*$/
    )?.[1];
    return (code as AiRecommendationErrorCode) ?? 'unavailable';
}

export function canonicalDashboardAiSignals(
    signals?: AiRecommendationTasteSignals
): unknown {
    return signals
        ? Object.keys(signals)
              .sort()
              .map((name) => [
                  name,
                  [...signals[name as keyof AiRecommendationTasteSignals]]
                      .map((entry) => {
                          const ordered: Record<string, unknown> = {};
                          Object.keys(entry)
                              .sort()
                              .forEach((key) => {
                                  const value = (
                                      entry as unknown as Record<
                                          string,
                                          unknown
                                      >
                                  )[key];
                                  ordered[key] =
                                      key === 'genreIds' && Array.isArray(value)
                                          ? [...value].sort((a, b) => a - b)
                                          : value;
                              });
                          return ordered;
                      })
                      .sort((a, b) =>
                          JSON.stringify(a).localeCompare(JSON.stringify(b))
                      ),
              ])
        : undefined;
}
