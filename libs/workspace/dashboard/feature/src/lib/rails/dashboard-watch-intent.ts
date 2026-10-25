import {
    MAX_AI_PREFERENCES_LENGTH,
    normalizeAiRecommendationSettings,
} from '@iptvnator/shared/interfaces';

export const MAX_WATCH_INTENT_LENGTH = 500;

/** A watch request guides this visit without changing saved taste or consent. */
export function dashboardWatchIntentSettings(
    settings: unknown,
    intent: string
) {
    const config = normalizeAiRecommendationSettings(settings);
    const request = intent.trim().slice(0, MAX_WATCH_INTENT_LENGTH);
    if (!request) return config;
    const instruction = `Current watch request (prioritize for this session): ${request}`;
    const taste = config.preferences.slice(
        0,
        MAX_AI_PREFERENCES_LENGTH - instruction.length - 2
    );
    return {
        ...config,
        preferences: taste ? `${taste}\n\n${instruction}` : instruction,
    };
}
