export interface AiRecommendationSettings {
    enabled: boolean;
    model: string;
    preferences: string;
}

export const DEFAULT_AI_RECOMMENDATION_SETTINGS: AiRecommendationSettings = {
    enabled: false,
    model: 'security',
    preferences: '',
};

export const MAX_AI_RECOMMENDATION_CANDIDATES = 40;
export const MAX_AI_PREFERENCES_LENGTH = 2000;
export const MAX_AI_MODEL_LENGTH = 100;
export const MAX_AI_REASON_LENGTH = 240;

export function normalizeAiRecommendationSettings(
    value: unknown
): AiRecommendationSettings {
    const settings = value as Partial<AiRecommendationSettings> | null;
    return {
        enabled: settings?.enabled === true,
        model:
            typeof settings?.model === 'string'
                ? settings.model.trim() ||
                  DEFAULT_AI_RECOMMENDATION_SETTINGS.model
                : DEFAULT_AI_RECOMMENDATION_SETTINGS.model,
        preferences:
            typeof settings?.preferences === 'string'
                ? settings.preferences.trim()
                : '',
    };
}

export interface AiRecommendationCandidate {
    id: string;
    title: string;
    year: number | null;
    mediaType: 'movie' | 'tv';
    genreIds: readonly number[];
}

export interface AiRecommendationRankRequest {
    model: string;
    preferences: string;
    candidates: readonly AiRecommendationCandidate[];
}

export interface AiRecommendationRankResponse {
    ranked: readonly { id: string; reason: string }[];
}

export const AI_RECOMMENDATIONS_STATUS = 'ai-recommendations-status';
export const AI_RECOMMENDATIONS_RANK = 'ai-recommendations-rank';
