import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslatePipe } from '@ngx-translate/core';
import { MockPipe } from 'ng-mocks';
import { LiveOnNowStageComponent } from './live-on-now-stage.component';
import type { LiveOnNowLastWatched, LiveOnNowTile } from './live-on-now.model';

const NOW = new Date(2026, 2, 12, 21, 12).getTime();

const TILES: LiveOnNowTile[] = [
    {
        id: '11',
        name: 'Aurora News',
        logoUrl: 'https://logos.example.test/aurora.png',
        program: {
            title: 'Global Window',
            timeRange: '21:00 – 21:30',
            endsAt: '21:30',
            minutesLeft: 18,
            progress: 40,
        },
    },
    {
        id: '12',
        name: 'Motion Sports',
        logoUrl: null,
        program: {
            title: 'Harbor Derby',
            timeRange: '20:00 – 22:45',
            endsAt: '22:45',
            minutesLeft: 93,
            progress: 71,
        },
    },
    { id: '13', name: 'Civic One', logoUrl: null, program: null },
];

@Component({
    imports: [LiveOnNowStageComponent],
    template: `
        <app-live-on-now-stage
            [tiles]="tiles()"
            [lastWatched]="lastWatched()"
            [source]="source()"
            [sourceLabel]="'Newsroom'"
            [nowMs]="now"
            (channelSelected)="selected.push($event)"
        />
    `,
})
class HostComponent {
    readonly tiles = signal<LiveOnNowTile[]>(TILES);
    readonly lastWatched = signal<LiveOnNowLastWatched | null>({
        id: '11',
        name: 'Aurora News',
        logoUrl: null,
        watchedAtMs: NOW - 12 * 60_000,
    });
    readonly source = signal<'favorites' | 'category'>('favorites');
    readonly now = NOW;
    readonly selected: string[] = [];
}

describe('LiveOnNowStageComponent', () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;

    const element = (): HTMLElement => fixture.nativeElement;
    const tiles = () =>
        Array.from(
            element().querySelectorAll<HTMLButtonElement>(
                '[data-test-id="live-on-now-tile"]'
            )
        );

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [HostComponent] })
            .overrideComponent(LiveOnNowStageComponent, {
                remove: { imports: [TranslatePipe] },
                add: {
                    imports: [
                        MockPipe(
                            TranslatePipe,
                            (key: string, params?: Record<string, unknown>) =>
                                params
                                    ? `${key}:${JSON.stringify(params)}`
                                    : key
                        ),
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(HostComponent);
        host = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('renders the heading, the favorites subline and the clock', () => {
        expect(element().querySelector('.stage__title')?.textContent).toContain(
            'LIVE_ON_NOW.TITLE'
        );
        const subline = element().querySelector('.stage__subline')?.textContent;
        expect(subline).toContain('LIVE_ON_NOW.ACROSS_FAVORITES');
        expect(subline).toContain('"count":3');
        expect(subline).toContain('21:12');
    });

    it('names the category in the subline for the fallback source', () => {
        host.source.set('category');
        fixture.detectChanges();

        expect(
            element().querySelector('.stage__subline')?.textContent
        ).toContain(
            'LIVE_ON_NOW.FROM_CATEGORY:{"count":3,"category":"Newsroom"}'
        );
    });

    it('spans the first tile, shows range + minutes left there and "ends at" elsewhere', () => {
        const [hero, second] = tiles();

        expect(hero.classList).toContain('tile--hero');
        expect(hero.querySelector('.tile__live-chip')).not.toBeNull();
        expect(hero.querySelector('.tile__headline')?.textContent).toContain(
            'Global Window'
        );
        expect(hero.querySelector('.tile__time')?.textContent).toContain(
            '21:00 – 21:30'
        );
        expect(hero.querySelector('.tile__time')?.textContent).toContain(
            'LIVE_ON_NOW.MINUTES_LEFT:{"count":18}'
        );
        expect(
            (hero.querySelector('.tile__progress i') as HTMLElement).style.width
        ).toBe('40%');

        expect(second.classList).not.toContain('tile--hero');
        expect(second.querySelector('.tile__live-chip')).toBeNull();
        expect(second.querySelector('.tile__time')?.textContent).toContain(
            'LIVE_ON_NOW.ENDS_AT:{"time":"22:45"}'
        );
    });

    it('renders logo + name only, with no progress bar, when a tile has no programme', () => {
        const bare = tiles()[2];

        expect(bare.querySelector('.tile__name')?.textContent).toContain(
            'Civic One'
        );
        expect(bare.querySelector('.tile__headline')).toBeNull();
        expect(bare.querySelector('.tile__progress')).toBeNull();
        expect(
            bare.querySelector('.tile__logo--fallback')?.textContent?.trim()
        ).toBe('CO');
    });

    it('falls back to initials once the logo image fails', () => {
        const hero = tiles()[0];
        expect(hero.querySelector('.tile__logo img')).not.toBeNull();

        hero.querySelector('img')?.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        expect(hero.querySelector('.tile__logo img')).toBeNull();
        expect(
            hero.querySelector('.tile__logo--fallback')?.textContent?.trim()
        ).toBe('AN');
    });

    it('emits the channel id from a tile click and from Tune in', () => {
        tiles()[1].click();
        element()
            .querySelector<HTMLButtonElement>(
                '[data-test-id="live-on-now-tune-in"]'
            )
            ?.click();

        expect(host.selected).toEqual(['12', '11']);
        expect(
            element().querySelector('[data-test-id="live-on-now-last-watched"]')
                ?.textContent
        ).toContain('LIVE_ON_NOW.MINUTES_AGO:{"count":12}');
    });

    it('shows the plain select-channel state when there is nothing to show', () => {
        host.tiles.set([]);
        host.lastWatched.set(null);
        fixture.detectChanges();

        expect(
            element().querySelector('[data-test-id="live-on-now-stage"]')
        ).toBeNull();
        expect(element().textContent).toContain(
            'CHANNELS.SELECT_CHANNEL_PLAYBACK'
        );
    });
});
