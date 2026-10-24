import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MovieCompanionComponent } from './movie-companion.component';

describe('MovieCompanionComponent', () => {
    let fixture: ComponentFixture<MovieCompanionComponent>;
    const query = (selector: string) =>
        (fixture.nativeElement as HTMLElement).querySelector(selector);
    const recommendations = [
        {
            tmdbId: 2,
            title: 'Another movie',
            year: 2024,
            posterUrl: '/poster.jpg',
        },
        { tmdbId: 3, title: 'Library movie', year: 2021, posterUrl: null },
    ];

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [MovieCompanionComponent, TranslateModule.forRoot()],
        }).compileComponents();
        fixture = TestBed.createComponent(MovieCompanionComponent);
    });

    it('leaves unknown facts and absent recommendations empty', () => {
        fixture.detectChanges();
        expect(query('section')).toBeNull();
        fixture.componentRef.setInput('facts', {
            tmdbId: 1,
            budget: 0,
            revenue: 0,
        });
        fixture.detectChanges();
        expect(query('[data-test-id="movie-facts"]')).toBeNull();
    });

    it('links stated facts to the matched movie and labels monetary units', () => {
        fixture.componentRef.setInput('facts', {
            tmdbId: 1,
            musicBy: ['A composer'],
            budget: 1000000,
        });
        fixture.detectChanges();
        expect(query('.movie-facts')?.textContent).toContain('A composer');
        expect(query('.movie-facts')?.textContent).toContain('$1,000,000');
        expect(query('.source-link')?.getAttribute('href')).toBe(
            'https://www.themoviedb.org/movie/1'
        );
        expect(query('.source-link')?.getAttribute('rel')).toBe(
            'noopener noreferrer'
        );
    });

    it('separates playable recommendations from external exploration and excludes duplicates', () => {
        const selected = jest.fn();
        fixture.componentInstance.itemSelected.subscribe(selected);
        fixture.componentRef.setInput('facts', { tmdbId: 1 });
        fixture.componentRef.setInput('recommendations', [
            ...recommendations,
            recommendations[0],
            { ...recommendations[0], tmdbId: -1 },
            { ...recommendations[0], tmdbId: 1 },
        ]);
        fixture.componentRef.setInput('availableItems', [
            {
                key: 'other:42',
                title: 'Library movie',
                year: 2021,
                posterUrl: null,
            },
        ]);
        fixture.detectChanges();
        const discovery = (
            fixture.nativeElement as HTMLElement
        ).querySelectorAll('[data-test-id="movie-discovery-recommendation"]');
        expect(discovery).toHaveLength(1);
        expect(discovery[0].getAttribute('href')).toBe(
            'https://www.themoviedb.org/movie/2'
        );
        expect(query('.section-caption')?.textContent).toContain(
            'MOVIE_COMPANION.LIBRARY'
        );
        (
            query(
                '[data-test-id="movie-library-recommendation"]'
            ) as HTMLButtonElement
        ).click();
        expect(selected).toHaveBeenCalledWith('other:42');
    });

    it('keeps a different-year film available for discovery', () => {
        fixture.componentRef.setInput('recommendations', recommendations);
        fixture.componentRef.setInput('availableItems', [
            {
                key: 'copy',
                title: 'Library movie',
                year: 1980,
                posterUrl: null,
            },
        ]);
        fixture.detectChanges();
        expect(
            (fixture.nativeElement as HTMLElement).querySelectorAll(
                '[data-test-id="movie-discovery-recommendation"]'
            )
        ).toHaveLength(2);
    });

    it('deduplicates provider release tags without confusing a title year with its release', () => {
        fixture.componentRef.setInput('recommendations', [
            ...recommendations,
            { tmdbId: 4, title: 'Blade Runner', year: 1982, posterUrl: null },
        ]);
        fixture.componentRef.setInput('availableItems', [
            { key: 'tagged', title: 'Library movie (2021)', posterUrl: null },
            { key: 'sequel', title: 'Blade Runner 2049', posterUrl: null },
        ]);
        fixture.detectChanges();
        const links = (fixture.nativeElement as HTMLElement).querySelectorAll(
            '[data-test-id="movie-discovery-recommendation"]'
        );
        expect(links).toHaveLength(2);
        expect(
            Array.from(links).map((link) => link.getAttribute('href'))
        ).toEqual([
            'https://www.themoviedb.org/movie/2',
            'https://www.themoviedb.org/movie/4',
        ]);
    });

    it('replaces broken artwork with the fallback without removing its action', () => {
        fixture.componentRef.setInput('recommendations', recommendations);
        fixture.detectChanges();
        query('.poster img')?.dispatchEvent(new Event('error'));
        fixture.detectChanges();
        expect(query('.poster img')).toBeNull();
        expect(
            query('[data-test-id="movie-discovery-recommendation"]')
        ).toBeTruthy();
    });
});
