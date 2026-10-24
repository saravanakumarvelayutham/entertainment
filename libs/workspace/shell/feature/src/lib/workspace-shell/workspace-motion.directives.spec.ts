import {
    ChangeDetectionStrategy,
    Component,
    CUSTOM_ELEMENTS_SCHEMA,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkspacePointerMotionDirective } from './workspace-pointer-motion.directive';
import { WorkspaceNavIndicatorDirective } from './workspace-nav-indicator.directive';

@Component({
    imports: [WorkspacePointerMotionDirective, WorkspaceNavIndicatorDirective],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div appWorkspacePointerMotion appWorkspaceNavIndicator>
        <div class="global-links">
            <nav class="rail-links">
                <a aria-current="page">Library</a><a>Sources</a>
            </nav>
        </div>
        <div class="rail__card"><div class="rail__art"></div></div>
        <div class="content-card"><div class="thumbnail-wrapper"></div></div>
        <app-movie-companion
            ><a class="recommendation"><span class="poster"></span></a
        ></app-movie-companion>
        <app-content-hero
            ><section class="hero"><div class="poster"></div></section
        ></app-content-hero>
    </div>`,
})
class MotionHostComponent {}

describe('workspace pointer motion and navigation marker', () => {
    let fixture: ComponentFixture<MotionHostComponent>;
    let card: HTMLElement;
    let frames: FrameRequestCallback[];
    let reduced: boolean;
    let finePointer: boolean;
    const originalMatchMedia = window.matchMedia;
    const originalResizeObserver = globalThis.ResizeObserver;

    const rect = (left: number, top: number, width: number, height: number) =>
        ({
            left,
            top,
            width,
            height,
            right: left + width,
            bottom: top + height,
        }) as DOMRect;
    const flush = () => {
        const pending = frames;
        frames = [];
        pending.forEach((callback) => callback(0));
    };
    const move = (x: number, y: number, pointerType = 'mouse') => {
        const event = new MouseEvent('pointermove', {
            bubbles: true,
            clientX: x,
            clientY: y,
        });
        Object.defineProperty(event, 'pointerType', { value: pointerType });
        card.querySelector('.rail__art')?.dispatchEvent(event);
        flush();
    };

    beforeEach(() => {
        frames = [];
        reduced = false;
        finePointer = true;
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: jest.fn((query: string) => ({
                get matches() {
                    return query.includes('reduced-motion')
                        ? reduced
                        : finePointer;
                },
                addEventListener: jest.fn(),
                removeEventListener: jest.fn(),
            })),
        });
        globalThis.ResizeObserver = class {
            observe = jest.fn();
            unobserve = jest.fn();
            disconnect = jest.fn();
        } as unknown as typeof ResizeObserver;
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(
            (callback) => {
                frames.push(callback);
                return frames.length;
            }
        );
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(
            () => undefined
        );
        fixture = TestBed.createComponent(MotionHostComponent);
        fixture.detectChanges();
        card = fixture.nativeElement.querySelector('.rail__card');
        jest.spyOn(card, 'getBoundingClientRect').mockReturnValue(
            rect(100, 100, 200, 300)
        );
        flush();
    });

    afterEach(() => {
        fixture.destroy();
        jest.restoreAllMocks();
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: originalMatchMedia,
        });
        globalThis.ResizeObserver = originalResizeObserver;
        delete document.documentElement.dataset.workspaceMotion;
    });

    it('maps pointer position to bounded tilt and clears it when leaving a card', () => {
        move(290, 110);
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(true);
        expect(
            parseFloat(card.style.getPropertyValue('--workspace-tilt-x'))
        ).toBeGreaterThan(0);
        expect(
            parseFloat(card.style.getPropertyValue('--workspace-tilt-y'))
        ).toBeGreaterThan(0);
        move(5000, -5000);
        expect(card.style.getPropertyValue('--workspace-tilt-x')).toBe(
            '7.00deg'
        );
        expect(card.style.getPropertyValue('--workspace-tilt-y')).toBe(
            '9.00deg'
        );
        fixture.nativeElement
            .querySelector('[appWorkspacePointerMotion]')
            .dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(false);
        expect(card.style.getPropertyValue('--workspace-tilt-x')).toBe('');
    });

    it('preserves hover while another row scrolls, but clears when its own viewport scrolls', () => {
        move(290, 110);
        fixture.nativeElement
            .querySelector('.content-card')
            .dispatchEvent(new Event('scroll'));
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(true);
        card.parentElement?.dispatchEvent(new Event('scroll'));
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(false);
    });

    it('reacts on detail recommendations and targets the detail poster independently of its hero', () => {
        for (const selector of [
            'app-movie-companion .recommendation',
            'app-content-hero .poster',
            '.content-card',
        ]) {
            const surface = fixture.nativeElement.querySelector(
                selector
            ) as HTMLElement;
            jest.spyOn(surface, 'getBoundingClientRect').mockReturnValue(
                rect(100, 100, 200, 300)
            );
            surface.dispatchEvent(
                new MouseEvent('pointermove', {
                    bubbles: true,
                    clientX: 290,
                    clientY: 110,
                })
            );
            flush();
            expect(surface.hasAttribute('data-workspace-pointer-active')).toBe(
                true
            );
            expect(
                parseFloat(surface.style.getPropertyValue('--workspace-tilt-y'))
            ).toBeGreaterThan(0);
        }
        expect(
            fixture.nativeElement
                .querySelector('app-content-hero .hero')
                .hasAttribute('data-workspace-pointer-active')
        ).toBe(false);
    });

    it('keeps hero backgrounds out of cursor motion', () => {
        const hero = fixture.nativeElement.querySelector(
            '.hero'
        ) as HTMLElement;
        hero.dispatchEvent(
            new MouseEvent('pointermove', {
                bubbles: true,
                clientX: 300,
                clientY: 100,
            })
        );
        flush();
        expect(hero.hasAttribute('data-workspace-pointer-active')).toBe(false);
        expect(hero.style.getPropertyValue('--workspace-parallax-x')).toBe('');
    });

    it('follows system reduction, allows Full, and clears immediately on explicit Reduced', async () => {
        reduced = true;
        move(290, 110);
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(false);
        document.documentElement.dataset.workspaceMotion = 'full';
        await new Promise((resolve) => setTimeout(resolve, 0));
        move(290, 110);
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(true);
        document.documentElement.dataset.workspaceMotion = 'reduced';
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(false);
    });

    it('ignores touch/coarse pointers and releases active surfaces on scrolling', () => {
        move(290, 110, 'touch');
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(false);
        finePointer = false;
        move(290, 110);
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(false);
        finePointer = true;
        move(290, 110);
        card.dispatchEvent(new Event('scroll'));
        expect(card.hasAttribute('data-workspace-pointer-active')).toBe(false);
    });

    it('moves the selection marker to the actual active link', async () => {
        const nav = fixture.nativeElement.querySelector(
            '.rail-links'
        ) as HTMLElement;
        const links = nav.querySelectorAll('a');
        jest.spyOn(nav, 'getBoundingClientRect').mockReturnValue(
            rect(20, 0, 400, 48)
        );
        jest.spyOn(links[1], 'getBoundingClientRect').mockReturnValue(
            rect(140, 0, 90, 38)
        );
        links[0].removeAttribute('aria-current');
        links[1].setAttribute('aria-current', 'page');
        await new Promise((resolve) => setTimeout(resolve, 0));
        flush();
        expect(nav.style.getPropertyValue('--workspace-nav-x')).toBe('120px');
        expect(nav.style.getPropertyValue('--workspace-nav-width')).toBe(
            '90px'
        );
        jest.mocked(links[1].getBoundingClientRect).mockReturnValue(
            rect(140, 0, 120, 38)
        );
        if (links[1].firstChild)
            links[1].firstChild.nodeValue = 'Translated sources';
        await new Promise((resolve) => setTimeout(resolve, 0));
        flush();
        expect(nav.style.getPropertyValue('--workspace-nav-width')).toBe(
            '120px'
        );
        links[1].removeAttribute('aria-current');
        await new Promise((resolve) => setTimeout(resolve, 0));
        flush();
        expect(nav.hasAttribute('data-workspace-nav-ready')).toBe(false);
        links[1].className = 'portal-rail-link is-active';
        await new Promise((resolve) => setTimeout(resolve, 0));
        flush();
        expect(nav.hasAttribute('data-workspace-nav-ready')).toBe(true);
        expect(nav.style.getPropertyValue('--workspace-nav-width')).toBe(
            '120px'
        );
    });
});
