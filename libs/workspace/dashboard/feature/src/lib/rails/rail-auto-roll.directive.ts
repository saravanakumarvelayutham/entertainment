import { DOCUMENT } from '@angular/common';
import {
    AfterViewInit,
    Directive,
    ElementRef,
    NgZone,
    OnDestroy,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
import { SettingsStore } from '@iptvnator/services';

/** Wraps native scrolling across two Angular-rendered passes of the same cards. */
@Directive({ selector: '[libRailAutoRoll]', exportAs: 'railAutoRoll' })
export class RailAutoRollDirective implements AfterViewInit, OnDestroy {
    readonly enabled = input(false, { alias: 'libRailAutoRoll' });
    readonly available = signal(false);
    readonly paused = signal(false);
    private readonly track =
        inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private readonly document = inject(DOCUMENT);
    private readonly zone = inject(NgZone);
    private readonly settings = inject(SettingsStore);
    private readonly surface =
        this.track.closest<HTMLElement>('.rail') ?? this.track;
    private reduced?: MediaQueryList;
    private intersection?: IntersectionObserver;
    private resize?: ResizeObserver;
    private preference?: MutationObserver;
    private content?: MutationObserver;
    private ready = false;
    private destroyed = false;
    private visible = false;
    private hovered = false;
    private frame: number | null = null;
    private resumeTimer?: ReturnType<typeof setTimeout>;
    private previousTime = 0;
    private position = 0;
    private lastWrite = 0;
    private manualUntil = 0;

    constructor() {
        effect(() => {
            this.enabled();
            this.paused();
            this.settings.workspaceMotion?.();
            this.zone.runOutsideAngular(this.refresh);
        });
    }

    ngAfterViewInit(): void {
        this.ready = true;
        this.zone.runOutsideAngular(() => {
            this.reduced = window.matchMedia?.(
                '(prefers-reduced-motion: reduce)'
            );
            this.reduced?.addEventListener?.('change', this.refresh);
            this.surface.addEventListener('pointerenter', this.enter);
            this.surface.addEventListener('pointerleave', this.leave);
            this.surface.addEventListener('focusin', this.refresh);
            this.surface.addEventListener('focusout', this.focusOut);
            for (const event of ['wheel', 'pointerdown', 'keydown'])
                this.surface.addEventListener(event, this.manual, {
                    passive: true,
                });
            this.document.addEventListener('visibilitychange', this.refresh);
            this.preference = new MutationObserver(this.refresh);
            this.preference.observe(this.document.documentElement, {
                attributes: true,
                attributeFilter: [
                    'data-workspace-motion',
                    'data-workspace-scene',
                ],
            });
            this.resize = new ResizeObserver(this.refresh);
            this.resize.observe(this.track);
            this.content = new MutationObserver(this.refresh);
            this.content.observe(this.track, { childList: true });
            if (typeof IntersectionObserver !== 'undefined') {
                this.intersection = new IntersectionObserver(
                    (entries) => {
                        this.visible = entries.some(
                            (entry) =>
                                entry.isIntersecting &&
                                entry.intersectionRatio >= 0.15
                        );
                        this.refresh();
                    },
                    { threshold: 0.15 }
                );
                this.intersection.observe(this.track);
            } else this.visible = true;
            this.refresh();
        });
    }

    toggle(): void {
        this.paused.update((value) => !value);
        this.zone.runOutsideAngular(this.refresh);
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.stop();
        clearTimeout(this.resumeTimer);
        this.intersection?.disconnect();
        this.resize?.disconnect();
        this.preference?.disconnect();
        this.content?.disconnect();
        this.reduced?.removeEventListener?.('change', this.refresh);
        this.surface.removeEventListener('pointerenter', this.enter);
        this.surface.removeEventListener('pointerleave', this.leave);
        this.surface.removeEventListener('focusin', this.refresh);
        this.surface.removeEventListener('focusout', this.focusOut);
        for (const event of ['wheel', 'pointerdown', 'keydown'])
            this.surface.removeEventListener(event, this.manual);
        this.document.removeEventListener('visibilitychange', this.refresh);
        this.track.classList.remove('rail__track--auto-roll');
    }

    private readonly enter = (): void => {
        this.hovered = true;
        this.refresh();
    };
    private readonly leave = (): void => {
        this.hovered = false;
        this.refresh();
    };
    private readonly focusOut = (): void => {
        queueMicrotask(this.refresh);
    };
    private readonly manual = (event: Event): void => {
        if (
            event.target instanceof Element &&
            event.target.closest('.rail__auto-roll')
        )
            return;
        this.manualUntil = performance.now() + 8000;
        clearTimeout(this.resumeTimer);
        this.resumeTimer = setTimeout(this.refresh, 8000);
        this.refresh();
    };

    private readonly refresh = (): void => {
        if (!this.ready || this.destroyed) return;
        const mode = this.settings.workspaceMotion?.() ?? 'system';
        const allowed =
            this.enabled() &&
            mode !== 'reduced' &&
            (mode === 'full' || !this.reduced?.matches) &&
            this.originalOverflow() > 2;
        this.available.set(allowed);
        // Keep snapping off while paused, so entering the row never jerks it
        // to the nearest card. Native manual scrolling and arrows still work.
        this.track.classList.toggle('rail__track--auto-roll', allowed);
        // Copies remain pointer-operable, but keyboard/assistive navigation
        // visits each movie only once. Angular owns their links and actions.
        for (const control of this.track.querySelectorAll<HTMLElement>(
            '[data-rail-copy] a, [data-rail-copy] button'
        ))
            control.tabIndex = -1;
        if (
            !allowed ||
            this.paused() ||
            !this.visible ||
            this.document.hidden ||
            this.hovered ||
            this.surface.matches(':hover') ||
            (this.surface.contains(this.document.activeElement) &&
                !this.document.activeElement?.classList.contains(
                    'rail__auto-roll'
                )) ||
            this.document.documentElement.hasAttribute(
                'data-workspace-scene'
            ) ||
            this.surface.querySelector('[aria-expanded="true"]') ||
            performance.now() < this.manualUntil
        ) {
            this.stop();
            return;
        }
        if (this.frame !== null) return;
        this.position = this.lastWrite = this.track.scrollLeft;
        this.previousTime = 0;
        this.track.setAttribute('data-auto-rolling', '');
        this.frame = requestAnimationFrame(this.tick);
    };

    private maximum(): number {
        return this.track.scrollWidth - this.track.clientWidth;
    }
    private period(): number {
        const copy = this.track.querySelector<HTMLElement>('[data-rail-copy]');
        const first = this.track.firstElementChild as HTMLElement | null;
        return copy && first ? copy.offsetLeft - first.offsetLeft : 0;
    }
    private originalOverflow(): number {
        const period = this.period();
        return period
            ? period -
                  (parseFloat(getComputedStyle(this.track).columnGap) || 0) -
                  this.track.clientWidth
            : this.maximum();
    }
    private stop(): void {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this.track.removeAttribute('data-auto-rolling');
    }
    private readonly tick = (time: number): void => {
        this.frame = null;
        const period = this.period();
        if (this.originalOverflow() <= 2) {
            this.refresh();
            return;
        }
        // Wait for Angular to render the second pass before crossing the seam.
        if (!period) {
            this.frame = requestAnimationFrame(this.tick);
            return;
        }
        // Honor a content refresh or external scroll reset instead of fighting it.
        if (Math.abs(this.track.scrollLeft - this.lastWrite) > 2)
            this.position = this.track.scrollLeft;
        const elapsed = this.previousTime
            ? Math.min(time - this.previousTime, 50) / 1000
            : 0;
        this.previousTime = time;
        // The two passes are visually identical one period apart; wrapping
        // preserves the subpixel overshoot and constant forward speed.
        this.position = (this.position + elapsed * 36) % period;
        this.track.scrollLeft = this.position;
        this.lastWrite = this.track.scrollLeft;
        this.frame = requestAnimationFrame(this.tick);
    };
}
