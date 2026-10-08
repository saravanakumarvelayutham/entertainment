import {
    parseAiRecommendationResponse,
    rankAiRecommendations,
    validateAiRecommendationRequest,
} from './ai-recommendations.service';

const request = {
    model: 'security',
    preferences: 'Thoughtful science fiction',
    candidates: [
        {
            id: 'movie:1',
            title: 'Arrival',
            year: 2016,
            mediaType: 'movie' as const,
            genreIds: [878],
        },
    ],
};

const tasteSignals = {
    watched: [
        {
            title: 'Arrival',
            mediaType: 'movie' as const,
            completion: 'completed' as const,
        },
    ],
    favorites: [{ title: 'Dark', mediaType: 'tv' as const }],
    votes: [
        {
            tmdbId: 329865,
            mediaType: 'movie' as const,
            genreIds: [878],
            choice: 'more-like-this' as const,
        },
    ],
};
const learnedRequest = { ...request, preferences: '', tasteSignals };

describe('AI recommendation gateway', () => {
    const originalToken = process.env.MODELS_AUTH_TOKEN;
    const originalFetch = global.fetch;
    let fetchMock: jest.Mock;
    beforeEach(() => {
        process.env.MODELS_AUTH_TOKEN = 'test-secret';
        fetchMock = jest.fn();
        global.fetch = fetchMock;
    });
    afterEach(() => {
        global.fetch = originalFetch;
        if (originalToken === undefined) delete process.env.MODELS_AUTH_TOKEN;
        else process.env.MODELS_AUTH_TOKEN = originalToken;
    });

    it('whitelists the request and never shares extra history fields', () => {
        expect(
            validateAiRecommendationRequest({ ...request, history: ['secret'] })
        ).toEqual(request);
    });
    it('accepts automatic learning without entered preferences and strips private signal fields', () => {
        expect(
            validateAiRecommendationRequest({
                ...learnedRequest,
                tasteSignals: {
                    watched: [
                        {
                            ...tasteSignals.watched[0],
                            playlistId: 'private',
                            url: 'secret',
                            date: 'today',
                        },
                    ],
                    favorites: [
                        { ...tasteSignals.favorites[0], sourceId: 'private' },
                    ],
                    votes: [{ ...tasteSignals.votes[0], timestamp: 42 }],
                },
            })
        ).toEqual(learnedRequest);
    });
    it.each([
        { watched: [], favorites: [], votes: [] },
        { ...tasteSignals, watched: Array(51).fill(tasteSignals.watched[0]) },
        {
            ...tasteSignals,
            favorites: Array(51).fill(tasteSignals.favorites[0]),
        },
        { ...tasteSignals, votes: Array(101).fill(tasteSignals.votes[0]) },
        {
            ...tasteSignals,
            watched: [{ ...tasteSignals.watched[0], completion: 'disliked' }],
        },
        {
            ...tasteSignals,
            favorites: [
                { ...tasteSignals.favorites[0], title: 'x'.repeat(301) },
            ],
        },
        {
            ...tasteSignals,
            votes: [{ ...tasteSignals.votes[0], choice: 'invalid' }],
        },
        { ...tasteSignals, votes: [{ ...tasteSignals.votes[0], tmdbId: NaN }] },
        {
            ...tasteSignals,
            votes: [
                { ...tasteSignals.votes[0], genreIds: Array(31).fill(878) },
            ],
        },
        {
            ...tasteSignals,
            votes: [{ ...tasteSignals.votes[0], genreIds: [NaN] }],
        },
        {
            ...tasteSignals,
            votes: [{ ...tasteSignals.votes[0], title: 'x'.repeat(301) }],
        },
    ])(
        'rejects malformed or oversized signals before networking',
        async (invalidSignals) => {
            await expect(
                rankAiRecommendations({
                    ...learnedRequest,
                    tasteSignals: invalidSignals,
                })
            ).rejects.toThrow('unavailable');
            expect(fetchMock).not.toHaveBeenCalled();
        }
    );
    it('rejects blank explicit preferences without learning evidence', () => {
        expect(() =>
            validateAiRecommendationRequest({ ...request, preferences: ' ' })
        ).toThrow('unavailable');
    });
    it('preserves optional vote titles while older id-only votes remain valid', () => {
        expect(
            validateAiRecommendationRequest({
                ...learnedRequest,
                tasteSignals: {
                    ...tasteSignals,
                    votes: [
                        {
                            ...tasteSignals.votes[0],
                            title: 'Arrival',
                            sourceId: 'private',
                        },
                    ],
                },
            }).tasteSignals?.votes
        ).toEqual([{ ...tasteSignals.votes[0], title: 'Arrival' }]);
    });
    it('learns and ranks with a single model call', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    tasteSummary:
                                        'Thoughtful science fiction and mystery.',
                                    ranked: [
                                        {
                                            id: 'movie:1',
                                            reason: 'Matches your favorite genres.',
                                        },
                                    ],
                                }),
                            },
                        },
                    ],
                })
            )
        );
        await expect(
            rankAiRecommendations(learnedRequest)
        ).resolves.toMatchObject({
            tasteSummary: 'Thoughtful science fiction and mystery.',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(JSON.parse(body.messages[1].content)).toEqual({
            preferences: '',
            candidates: request.candidates,
            tasteSignals,
        });
        expect(body.messages[0].content).toContain(
            'Never assume an abandoned title was disliked'
        );
    });
    it('learns a profile without an available candidate pool', async () => {
        const profileRequest = { ...learnedRequest, candidates: [] };
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    tasteSummary: 'Thoughtful science fiction.',
                                    ranked: [],
                                }),
                            },
                        },
                    ],
                })
            )
        );
        await expect(rankAiRecommendations(profileRequest)).resolves.toEqual({
            tasteSummary: 'Thoughtful science fiction.',
            ranked: [],
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('requires evidence for a profile-only request and a profile for its response', () => {
        expect(() =>
            validateAiRecommendationRequest({ ...request, candidates: [] })
        ).toThrow('unavailable');
        expect(() =>
            parseAiRecommendationResponse('{"ranked":[]}', {
                ...learnedRequest,
                candidates: [],
            })
        ).toThrow('unavailable');
        expect(() =>
            parseAiRecommendationResponse(
                '{"ranked":[],"tasteSummary":"Valid profile"}',
                learnedRequest
            )
        ).toThrow('unavailable');
    });
    it.each([undefined, '', ' ', 42, 'x'.repeat(1001)])(
        'requires a valid learned profile for signals: %s',
        (tasteSummary) => {
            expect(() =>
                parseAiRecommendationResponse(
                    JSON.stringify({
                        tasteSummary,
                        ranked: [{ id: 'movie:1', reason: 'Matches.' }],
                    }),
                    learnedRequest
                )
            ).toThrow('unavailable');
        }
    );
    it.each([
        { ...request, model: 'x'.repeat(101) },
        { ...request, preferences: 'x'.repeat(2001) },
        { ...request, candidates: Array(41).fill(request.candidates[0]) },
        {
            ...request,
            candidates: [request.candidates[0], request.candidates[0]],
        },
        {
            ...request,
            candidates: [{ ...request.candidates[0], title: 'x'.repeat(301) }],
        },
        {
            ...request,
            candidates: [{ ...request.candidates[0], genreIds: [NaN] }],
        },
    ])(
        'rejects invalid or oversized requests before networking',
        async (invalid) => {
            await expect(rankAiRecommendations(invalid)).rejects.toThrow(
                'unavailable'
            );
            expect(fetchMock).not.toHaveBeenCalled();
        }
    );
    it('does not call the endpoint when authentication is missing', async () => {
        delete process.env.MODELS_AUTH_TOKEN;
        await expect(rankAiRecommendations(request)).rejects.toThrow(
            'unavailable'
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('uses the fixed gateway and blocks credential-bearing redirects', async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    ranked: [
                                        {
                                            id: 'movie:1',
                                            reason: 'Thoughtful science fiction.',
                                        },
                                    ],
                                }),
                            },
                        },
                    ],
                })
            )
        );
        await expect(rankAiRecommendations(request)).resolves.toEqual({
            ranked: [{ id: 'movie:1', reason: 'Thoughtful science fiction.' }],
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://models.saravlabs.org/v1/chat/completions',
            expect.objectContaining({
                redirect: 'error',
                headers: {
                    Authorization: 'Bearer test-secret',
                    'User-Agent': 'SaravLabs-Model-Gateway/1.0',
                    'Content-Type': 'application/json',
                },
            })
        );
    });
    it('returns a safe error without provider details or retries', async () => {
        fetchMock.mockRejectedValue(
            new Error('Authorization: Bearer test-secret')
        );
        await expect(rankAiRecommendations(request)).rejects.toThrow(
            'AI recommendations are unavailable. Try again later.'
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    it('bounds provider response bytes', async () => {
        fetchMock.mockResolvedValue(new Response('x'.repeat(128 * 1024 + 1)));
        await expect(rankAiRecommendations(request)).rejects.toThrow(
            'unavailable'
        );
    });
    it.each([
        { ranked: [] },
        { ranked: [{ id: 'unknown', reason: 'invented' }] },
        { ranked: [{ id: 'movie:1', reason: 'x'.repeat(241) }] },
        { ranked: [{ id: 'movie:1', reason: '   ' }] },
        {
            ranked: [
                { id: 'movie:1', reason: 'ok' },
                { id: 'movie:1', reason: 'ok' },
            ],
        },
    ])('rejects malformed ranking as a whole', (value) => {
        expect(() =>
            parseAiRecommendationResponse(JSON.stringify(value), request)
        ).toThrow();
    });
    it('accepts a JSON fenced response and strips untrusted extra fields', () => {
        expect(
            parseAiRecommendationResponse(
                '```json\n' +
                    JSON.stringify({
                        ranked: [
                            {
                                id: 'movie:1',
                                reason: ' Fits your tastes. ',
                                url: 'bad',
                            },
                        ],
                    }) +
                    '\n```',
                request
            )
        ).toEqual({
            ranked: [{ id: 'movie:1', reason: 'Fits your tastes.' }],
        });
    });
});
