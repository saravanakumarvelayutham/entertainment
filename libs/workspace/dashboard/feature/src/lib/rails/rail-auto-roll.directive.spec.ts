import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SettingsStore } from '@iptvnator/services';
import { RailAutoRollDirective } from './rail-auto-roll.directive';

@Component({
    imports: [RailAutoRollDirective],
    template: `
        <section class="rail">
            <div [libRailAutoRoll]="true" tabindex="0">
                <div><a href="#">Movie</a></div>
                <div data-rail-copy aria-hidden="true">
                    <a href="#">Movie</a>
                </div>
            </div>
        </section>
    `,
})
class RollHostComponent {}

describe('automatic movie rail rolling', () => {
    const originalResize = globalThis.ResizeObserver;
    const originalIntersection = globalThis.IntersectionObserver;
    const originalMedia = window.matchMedia;
    const motion = signal<'full' | 'system' | 'reduced'>('full');
    let intersect: (visible: boolean) => void;
    let resized: () => void;
    let mediaChanged: () => void;
    let reduced = false;
    let clock = 100;
    let nextFrame = 0;
    let frames: Map<number, FrameRequestCallback>;
    const advance = (milliseconds: number) => {
        for (let i = 0; i < milliseconds; i += 16) {
            clock += 16;
            const pending = [...frames.values()];
            frames.clear();
            pending.forEach((callback) => callback(clock));
        }
    };
    beforeEach(() => {
        motion.set('full');
        reduced = false;
        clock = 100;
        frames = new Map();
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(
            (callback) => {
                frames.set(++nextFrame, callback);
                return nextFrame;
            }
        );
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
            frames.delete(id);
        });
        jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({
                get matches() {
                    return reduced;
                },
                addEventListener: (_: string, callback: () => void) => {
                    mediaChanged = callback;
                },
                removeEventListener: jest.fn(),
            }),
        });
        globalThis.ResizeObserver = class {
            constructor(callback: () => void) {
                resized = callback;
            }
            observe = jest.fn();
            disconnect = jest.fn();
            unobserve = jest.fn();
        } as unknown as typeof ResizeObserver;
        globalThis.IntersectionObserver = class {
            constructor(callback: (entries: unknown[]) => void) {
                intersect = (visible) =>
                    callback([
                        {
                            isIntersecting: visible,
                            intersectionRatio: visible ? 1 : 0,
                        },
                    ]);
            }
            observe = jest.fn();
            disconnect = jest.fn();
        } as unknown as typeof IntersectionObserver;
        TestBed.configureTestingModule({
            imports: [RollHostComponent],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { workspaceMotion: motion },
                },
            ],
        });
    });
    afterEach(() => {
        TestBed.resetTestingModule();
        jest.restoreAllMocks();
        globalThis.ResizeObserver = originalResize;
        globalThis.IntersectionObserver = originalIntersection;
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: originalMedia,
        });
    });
    function create() {
        const fixture = TestBed.createComponent(RollHostComponent);
        fixture.detectChanges();
        const debug = fixture.debugElement.query(
            By.directive(RailAutoRollDirective)
        );
        const track = debug.nativeElement as HTMLElement;
        Object.defineProperties(track, {
            clientWidth: { value: 400 },
            scrollWidth: { value: 1600 },
            scrollLeft: { value: 0, writable: true },
        });
        Object.defineProperty(track.children[0], 'offsetLeft', { value: 0 });
        Object.defineProperty(track.children[1], 'offsetLeft', { value: 800 });
        const directive = debug.injector.get(RailAutoRollDirective);
        resized();
        intersect(true);
        return {
            fixture,
            track,
            directive,
            rail: track.parentElement ?? track,
        };
    }
    it('wraps seamlessly at constant forward speed without reversing or adding DOM clones', () => {
        const { track } = create();
        advance(2000);
        expect(track.scrollLeft).toBeGreaterThan(20);
        expect(track.children).toHaveLength(2);
        track.scrollLeft = 799;
        advance(1000);
        expect(track.scrollLeft).toBeGreaterThan(25);
        expect(track.scrollLeft).toBeLessThan(45);
        const wrapped = track.scrollLeft;
        advance(1000);
        expect(track.scrollLeft).toBeGreaterThan(wrapped + 30);
        expect(
            track.querySelector('[data-rail-copy] a')?.getAttribute('tabindex')
        ).toBe('-1');
        expect(track.classList.contains('rail__track--auto-roll')).toBe(true);
    });
    it('pauses for hover, focus and explicit pause, and resumes after leaving', async () => {
        const { track, rail, directive } = create();
        advance(1000);
        rail.dispatchEvent(new Event('pointerenter'));
        const stopped = track.scrollLeft;
        advance(1000);
        expect(track.scrollLeft).toBe(stopped);
        rail.dispatchEvent(new Event('pointerleave'));
        advance(1000);
        expect(track.scrollLeft).toBeGreaterThan(stopped);
        track.focus();
        const focused = track.scrollLeft;
        advance(1000);
        expect(track.scrollLeft).toBe(focused);
        track.blur();
        await Promise.resolve();
        directive.toggle();
        const paused = track.scrollLeft;
        advance(1000);
        expect(track.scrollLeft).toBe(paused);
        directive.toggle();
        advance(1000);
        expect(track.scrollLeft).toBeGreaterThan(paused);
    });
    it('stops offscreen, on manual wheel input and after destruction', () => {
        const { track, fixture } = create();
        advance(1000);
        intersect(false);
        const stopped = track.scrollLeft;
        advance(1000);
        expect(track.scrollLeft).toBe(stopped);
        intersect(true);
        advance(1000);
        expect(track.scrollLeft).toBeGreaterThan(stopped);
        track.dispatchEvent(new Event('wheel', { bubbles: true }));
        const manual = track.scrollLeft;
        advance(1000);
        expect(track.scrollLeft).toBe(manual);
        fixture.destroy();
        expect(frames.size).toBe(0);
    });
    it('holds the row while its action menu is open', () => {
        const { track } = create();
        advance(1000);
        track.firstElementChild?.setAttribute('aria-expanded', 'true');
        resized();
        const stopped = track.scrollLeft;
        advance(1000);
        expect(track.scrollLeft).toBe(stopped);
        track.firstElementChild?.removeAttribute('aria-expanded');
        resized();
        advance(1000);
        expect(track.scrollLeft).toBeGreaterThan(stopped);
    });

    it('respects System/Reduced while allowing Full motion', () => {
        const { track, fixture } = create();
        reduced = true;
        motion.set('system');
        fixture.detectChanges();
        mediaChanged();
        advance(1000);
        expect(track.scrollLeft).toBe(0);
        motion.set('full');
        fixture.detectChanges();
        advance(1000);
        expect(track.scrollLeft).toBeGreaterThan(0);
        motion.set('reduced');
        fixture.detectChanges();
        const stopped = track.scrollLeft;
        advance(1000);
        expect(track.scrollLeft).toBe(stopped);
    });
});
