import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import {
    DashboardRailCard,
    DashboardRailComponent,
} from './dashboard-rail.component';

describe('DashboardRailComponent', () => {
    const createComponent = async (stripCountryPrefix: boolean) => {
        await TestBed.configureTestingModule({
            imports: [DashboardRailComponent],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: {
                        stripCountryPrefix: signal(stripCountryPrefix),
                    },
                },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(DashboardRailComponent);
        fixture.componentRef.setInput('label', 'Rail');
        fixture.componentRef.setInput('items', []);
        return fixture.componentInstance as unknown as {
            cardTitle(card: DashboardRailCard): string;
        };
    };

    const card = (overrides: Partial<DashboardRailCard>): DashboardRailCard =>
        ({
            id: 'card-1',
            title: 'US | CNN',
            icon: 'live_tv',
            link: ['/workspace'],
            ...overrides,
        }) as DashboardRailCard;

    afterEach(() => {
        TestBed.resetTestingModule();
    });

    it('strips the prefix from live card titles when the setting is enabled', async () => {
        const component = await createComponent(true);

        expect(component.cardTitle(card({ contentType: 'live' }))).toBe('CNN');
    });

    it('keeps movie and series card titles untouched', async () => {
        const component = await createComponent(true);

        expect(
            component.cardTitle(
                card({ title: 'US | Some Movie', contentType: 'movie' })
            )
        ).toBe('US | Some Movie');
        expect(
            component.cardTitle(
                card({ title: 'US | Some Show', contentType: 'series' })
            )
        ).toBe('US | Some Show');
    });

    it('keeps live card titles untouched while the setting is disabled', async () => {
        const component = await createComponent(false);

        expect(component.cardTitle(card({ contentType: 'live' }))).toBe(
            'US | CNN'
        );
    });

    describe('expiry badge rendering', () => {
        beforeEach(() => {
            // jsdom has no ResizeObserver; the component observes its track
            // element after view init.
            (
                globalThis as unknown as { ResizeObserver: unknown }
            ).ResizeObserver = class {
                observe = jest.fn();
                unobserve = jest.fn();
                disconnect = jest.fn();
            };
        });

        const renderCards = async (items: DashboardRailCard[]) => {
            await TestBed.configureTestingModule({
                imports: [DashboardRailComponent, TranslateModule.forRoot()],
                providers: [
                    provideRouter([]),
                    {
                        provide: SettingsStore,
                        useValue: { stripCountryPrefix: signal(false) },
                    },
                ],
            }).compileComponents();

            const fixture = TestBed.createComponent(DashboardRailComponent);
            fixture.componentRef.setInput('label', 'Sources');
            fixture.componentRef.setInput('items', items);
            fixture.detectChanges();
            return fixture.nativeElement as HTMLElement;
        };

        it('renders the chip only for cards with a badge and tones expired ones', async () => {
            const element = await renderCards([
                card({
                    id: 'expiring',
                    subtitle: 'Xtream',
                    expiryBadge: {
                        kind: 'expiring',
                        label: 'Expires in 3 d',
                    },
                }),
                card({
                    id: 'expired',
                    subtitle: 'Stalker',
                    expiryBadge: { kind: 'expired', label: 'Expired' },
                }),
                card({ id: 'plain', subtitle: 'M3U' }),
            ]);

            const chips = element.querySelectorAll('.rail__card-expiry');
            expect(chips).toHaveLength(2);
            expect(chips[0].textContent?.trim()).toBe('Expires in 3 d');
            expect(
                chips[0].classList.contains('rail__card-expiry--expired')
            ).toBe(false);
            expect(chips[1].textContent?.trim()).toBe('Expired');
            expect(
                chips[1].classList.contains('rail__card-expiry--expired')
            ).toBe(true);
        });
    });
    describe('landscape and ranked layouts', () => {
        const mountRail = async (
            layout: 'landscape' | 'ranked',
            items: DashboardRailCard[]
        ) => {
            (
                globalThis as unknown as { ResizeObserver: unknown }
            ).ResizeObserver = class {
                observe = jest.fn();
                disconnect = jest.fn();
            };
            await TestBed.configureTestingModule({
                imports: [DashboardRailComponent, TranslateModule.forRoot()],
                providers: [
                    provideRouter([]),
                    {
                        provide: SettingsStore,
                        useValue: { stripCountryPrefix: signal(false) },
                    },
                ],
            }).compileComponents();
            const fixture = TestBed.createComponent(DashboardRailComponent);
            fixture.componentRef.setInput('label', 'Rail');
            fixture.componentRef.setInput('layout', layout);
            fixture.componentRef.setInput('testId', 'rail');
            fixture.componentRef.setInput('items', items);
            fixture.detectChanges();
            return fixture;
        };

        it('renders a landscape still with progress, episode chip and time left', async () => {
            const fixture = await mountRail('landscape', [
                card({
                    id: 'cw-1',
                    title: 'Skyline Sentinels',
                    contentType: 'series',
                    imageUrl: 'https://img.test/poster.jpg',
                    backdropUrl: 'https://img.test/backdrop.jpg',
                    watchProgress: 62,
                    episodeBadge: 'S2·E4',
                    remainingLabel: {
                        key: 'WORKSPACE.DASHBOARD.REMAINING_MINUTES',
                        params: { minutes: 17 },
                    },
                    actions: [
                        {
                            id: 'remove-from-history',
                            icon: 'delete',
                            labelKey: 'X',
                        },
                    ],
                }),
            ]);
            const element = fixture.nativeElement as HTMLElement;

            const art = element.querySelector('.rail__art--landscape');
            expect(art).not.toBeNull();
            expect(art?.classList.contains('rail__art--contained')).toBe(
                false
            );
            expect(
                art?.querySelector('img')?.getAttribute('src')
            ).toBe('https://img.test/backdrop.jpg');
            expect(
                art?.querySelector<HTMLElement>('.rail__art-progress i')?.style
                    .width
            ).toBe('62%');
            expect(
                art?.querySelector('.rail__art-chip')?.textContent?.trim()
            ).toBe('S2·E4');
            expect(
                element
                    .querySelector('[data-test-id="rail-card-remaining"]')
                    ?.textContent?.trim()
            ).toBe('WORKSPACE.DASHBOARD.REMAINING_MINUTES');
            expect(
                element.querySelector('[data-test-id="rail-card-actions"]')
            ).not.toBeNull();
            fixture.destroy();
        });

        it('contains the poster over its blurred copy when no backdrop exists, and falls back to the icon after a failure', async () => {
            const fixture = await mountRail('landscape', [
                card({
                    id: 'cw-2',
                    title: 'The Paper Astronaut',
                    contentType: 'movie',
                    imageUrl: 'https://img.test/poster.jpg',
                }),
            ]);
            const element = fixture.nativeElement as HTMLElement;

            const art = element.querySelector('.rail__art--landscape');
            expect(art?.classList.contains('rail__art--contained')).toBe(true);
            expect(art?.querySelector('.rail__art-bg')).not.toBeNull();
            expect(art?.querySelector('img')?.getAttribute('src')).toBe(
                'https://img.test/poster.jpg'
            );

            art?.querySelector('img')?.dispatchEvent(new Event('error'));
            fixture.detectChanges();
            expect(
                element.querySelector('.rail__art--landscape img')
            ).toBeNull();
            expect(
                element.querySelector('.rail__art--landscape .rail__art-fallback')
            ).not.toBeNull();
            fixture.destroy();
        });

        it('renders the rank numeral beside ranked posters only', async () => {
            const fixture = await mountRail('ranked', [
                card({
                    id: 't-1',
                    title: 'Black Harbor',
                    contentType: 'movie',
                    rank: 1,
                }),
                card({
                    id: 't-2',
                    title: 'Unranked',
                    contentType: 'movie',
                }),
            ]);
            const element = fixture.nativeElement as HTMLElement;

            const ranks = element.querySelectorAll(
                '[data-test-id="rail-card-rank"]'
            );
            expect(ranks).toHaveLength(1);
            expect(ranks[0].textContent?.trim()).toBe('1');
            expect(
                element.querySelectorAll('.rail__card--ranked')
            ).toHaveLength(2);
            fixture.destroy();
        });
    });

    describe('recommendation cards', () => {
        it('shows the taste reason and accessible feedback without opening a menu', async () => {
            (
                globalThis as unknown as { ResizeObserver: unknown }
            ).ResizeObserver = class {
                observe = jest.fn();
                disconnect = jest.fn();
            };
            await TestBed.configureTestingModule({
                imports: [DashboardRailComponent, TranslateModule.forRoot()],
                providers: [
                    provideRouter([]),
                    {
                        provide: SettingsStore,
                        useValue: { stripCountryPrefix: signal(false) },
                    },
                ],
            }).compileComponents();
            const fixture = TestBed.createComponent(DashboardRailComponent);
            const recommendation = card({
                title: 'Arrival',
                contentType: 'movie',
                actions: [
                    {
                        id: 'recommendation-explanation',
                        label: 'Because you watched Contact',
                        icon: 'info',
                        disabled: true,
                    },
                    {
                        id: 'recommendation-undo-more-like-this',
                        label: 'Undo more like this',
                        icon: 'thumb_up',
                        pressed: true,
                    },
                    {
                        id: 'recommendation-not-for-me',
                        label: 'Not for me',
                        icon: 'thumb_down',
                    },
                ],
            });
            fixture.componentRef.setInput('label', 'Your picks');
            fixture.componentRef.setInput('layout', 'recommendation');
            fixture.componentRef.setInput('items', [recommendation]);
            fixture.detectChanges();
            const element = fixture.nativeElement as HTMLElement;
            expect(
                element.querySelector('.rail__reason')?.textContent
            ).toContain('Because you watched Contact');
            expect(element.querySelector('.rail__action-trigger')).toBeNull();
            const buttons = element.querySelectorAll<HTMLButtonElement>(
                '.rail__taste-action'
            );
            expect(buttons).toHaveLength(2);
            expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
            expect(buttons[0].getAttribute('aria-label')).toContain('Arrival');
            const selected = jest.fn();
            fixture.componentInstance.actionSelected.subscribe(selected);
            buttons[1].click();
            expect(selected).toHaveBeenCalledWith({
                card: recommendation,
                action: recommendation.actions?.[2],
            });

            fixture.componentRef.setInput('layout', 'cover');
            fixture.detectChanges();
            expect(element.querySelector('.rail__taste-actions')).toBeNull();
            expect(
                element.querySelector('.rail__action-trigger')
            ).not.toBeNull();
            fixture.destroy();
        });
    });
});
