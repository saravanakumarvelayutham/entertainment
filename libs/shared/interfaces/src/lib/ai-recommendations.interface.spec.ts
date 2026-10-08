import {
    DEFAULT_AI_RECOMMENDATION_SETTINGS,
    normalizeAiRecommendationSettings,
} from './ai-recommendations.interface';

describe('AI recommendation settings', () => {
    it.each([
        undefined,
        null,
        {},
        { enabled: 'true', model: 42, preferences: [] },
    ])('defaults to disabled for missing or malformed settings', (value) => {
        expect(normalizeAiRecommendationSettings(value)).toEqual(
            DEFAULT_AI_RECOMMENDATION_SETTINGS
        );
    });
    it('preserves explicit opt-in and trims entered preferences', () => {
        expect(
            normalizeAiRecommendationSettings({
                enabled: true,
                model: ' security ',
                preferences: ' Science fiction ',
            })
        ).toEqual({
            enabled: true,
            learnFromHistory: false,
            model: 'security',
            preferences: 'Science fiction',
        });
    });
    it('preserves previous explicit-only consent for already enabled profiles', () => {
        expect(
            normalizeAiRecommendationSettings({ enabled: true })
                .learnFromHistory
        ).toBe(false);
        expect(
            normalizeAiRecommendationSettings({ enabled: false })
                .learnFromHistory
        ).toBe(true);
        expect(
            normalizeAiRecommendationSettings({
                enabled: true,
                learnFromHistory: true,
            }).learnFromHistory
        ).toBe(true);
        expect(
            normalizeAiRecommendationSettings({
                enabled: false,
                learnFromHistory: false,
            }).learnFromHistory
        ).toBe(false);
    });
});
