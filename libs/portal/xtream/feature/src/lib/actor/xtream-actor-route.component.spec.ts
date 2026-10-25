import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import {
    CatalogTitleMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { of } from 'rxjs';
import { XtreamActorRouteComponent } from './xtream-actor-route.component';

describe('Xtream actor filmography navigation', () => {
    const vodStreams = signal<object[]>([]);
    let component: XtreamActorRouteComponent;
    let navigate: jest.SpyInstance;

    beforeEach(async () => {
        vodStreams.set([
            { stream_id: 5, name: 'Serenity (2005)', category_id: '9' },
            { stream_id: 19, name: 'Serenity (2019)', category_id: '10' },
        ]);
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                {
                    provide: ActivatedRoute,
                    useValue: {
                        params: of({ personId: '1' }),
                        snapshot: { params: { personId: '1' } },
                    },
                },
                {
                    provide: XtreamStore,
                    useValue: {
                        vodStreams,
                        serialStreams: signal([]),
                        currentPlaylist: () => ({ id: 'portal' }),
                    },
                },
                {
                    provide: CatalogTitleMatchService,
                    useValue: { isAvailable: false },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        getPersonDetails: jest.fn().mockResolvedValue({
                            id: 1,
                            name: 'Actor',
                            combined_credits: {
                                cast: [
                                    {
                                        id: 452832,
                                        media_type: 'movie',
                                        title: 'Serenity',
                                        release_date: '2019-01-25',
                                        character: 'Baker Dill',
                                    },
                                ],
                            },
                        }),
                    },
                },
            ],
        });
        navigate = jest
            .spyOn(TestBed.inject(Router), 'navigate')
            .mockResolvedValue(true);
        component = TestBed.runInInjectionContext(
            () => new XtreamActorRouteComponent()
        );
        TestBed.tick();
        await Promise.resolve();
        TestBed.tick();
    });

    it('opens the 2019 film from its credit even when the 2005 film occurs first', () => {
        const [credit] = component.items();
        expect(credit).toMatchObject({
            title: 'Serenity',
            year: 2019,
            available: true,
        });
        component.openItem(credit);
        expect(navigate).toHaveBeenCalledWith([
            '/workspace/xtreams',
            'portal',
            'vod',
            '10',
            19,
        ]);
    });

    it('offers search instead of opening a different release', () => {
        vodStreams.update((streams) => streams.slice(0, 1));
        const [credit] = component.items();
        expect(credit.available).toBe(false);
        component.openItem(credit);
        expect(navigate).toHaveBeenCalledWith(
            ['/workspace/xtreams', 'portal', 'search'],
            { queryParams: { q: 'Serenity' } }
        );
    });

    it('passes the filmography TMDB identity into portal matching', () => {
        vodStreams.set([
            {
                stream_id: 5,
                name: 'Serenity',
                category_id: '9',
                tmdb_id: 16320,
            },
            {
                stream_id: 19,
                name: 'Serenity',
                category_id: '10',
                tmdb_id: 452832,
            },
        ]);
        component.openItem(component.items()[0]);
        expect(navigate).toHaveBeenCalledWith([
            '/workspace/xtreams',
            'portal',
            'vod',
            '10',
            19,
        ]);
    });

    it('does not offer an untagged unknown release as in the library', () => {
        vodStreams.set([{ stream_id: 5, name: 'Serenity', category_id: '9' }]);
        const [credit] = component.items();
        expect(credit.available).toBe(false);
        component.openItem(credit);
        expect(navigate).toHaveBeenCalledWith(
            ['/workspace/xtreams', 'portal', 'search'],
            { queryParams: { q: 'Serenity' } }
        );
    });
});
