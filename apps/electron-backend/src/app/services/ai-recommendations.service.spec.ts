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
