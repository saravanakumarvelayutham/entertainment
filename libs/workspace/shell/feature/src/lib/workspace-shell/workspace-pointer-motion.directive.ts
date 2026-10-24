import { DOCUMENT } from '@angular/common';
import {
    AfterViewInit,
    Directive,
    ElementRef,
    inject,
    NgZone,
    OnDestroy,
} from '@angular/core';

/** One delegated listener for the workspace, with at most one tilted surface. */
@Directive({ selector: '[appWorkspacePointerMotion]' })
export class WorkspacePointerMotionDirective
    implements AfterViewInit, OnDestroy
{
    private readonly host =
        inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private readonly document = inject(DOCUMENT);
    private readonly zone = inject(NgZone);
    private surface: HTMLElement | null = null;
    private frame: number | null = null;
    private pointer = { x: 0, y: 0 };
    private reduced?: MediaQueryList;
    private finePointer?: MediaQueryList;
    private preferenceObserver?: MutationObserver;

    ngAfterViewInit(): void {
        this.zone.runOutsideAngular(() => {
            this.reduced = window.matchMedia?.(
                '(prefers-reduced-motion: reduce)'
            );
            this.finePointer = window.matchMedia?.(
                '(hover: hover) and (pointer: fine)'
            );
            this.host.addEventListener('pointermove', this.onPointerMove, {
                passive: true,
            });
            this.host.addEventListener('pointerleave', this.reset);
            this.host.addEventListener('pointercancel', this.reset);
            this.host.addEventListener('scroll', this.onScroll, {
                capture: true,
                passive: true,
            });
            this.reduced?.addEventListener('change', this.reset);
            this.finePointer?.addEventListener('change', this.reset);
            this.preferenceObserver = new MutationObserver(this.reset);
            this.preferenceObserver.observe(this.document.documentElement, {
                attributes: true,
                attributeFilter: ['data-workspace-motion'],
            });
        });
    }

    ngOnDestroy(): void {
        this.reset();
        this.host.removeEventListener('pointermove', this.onPointerMove);
        this.host.removeEventListener('pointerleave', this.reset);
        this.host.removeEventListener('pointercancel', this.reset);
        this.host.removeEventListener('scroll', this.onScroll, true);
        this.reduced?.removeEventListener('change', this.reset);
        this.finePointer?.removeEventListener('change', this.reset);
        this.preferenceObserver?.disconnect();
    }

    private enabled(): boolean {
        const mode = this.document.documentElement.dataset.workspaceMotion;
        return (
            mode !== 'reduced' &&
            (mode === 'full' || !this.reduced?.matches) &&
            (this.finePointer?.matches ?? true)
        );
    }

    private readonly onScroll = (event: Event): void => {
        // Another auto-rolling row does not move the hovered card's geometry.
        if (
            event.target instanceof Element &&
            event.target.contains(this.surface)
        )
            this.reset();
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        if (!this.enabled() || event.pointerType === 'touch') {
            this.reset();
            return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const surface =
            target?.closest<HTMLElement>(
                '.rail__card:not(.rail__card--channel), app-grid-list mat-card, .content-card, app-content-hero .poster, app-movie-companion .recommendation, .details__similar-card'
            ) ?? null;
        if (surface !== this.surface) {
            this.reset();
            this.surface = surface;
        }
        if (!surface || !this.host.contains(surface)) return;
        this.pointer = { x: event.clientX, y: event.clientY };
        this.frame ??= requestAnimationFrame(this.render);
    };

    private readonly render = (): void => {
        this.frame = null;
        if (!this.surface?.isConnected || !this.enabled()) {
            this.reset();
            return;
        }
        const rect = this.surface.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = Math.max(
            0,
            Math.min(1, (this.pointer.x - rect.left) / rect.width)
        );
        const y = Math.max(
            0,
            Math.min(1, (this.pointer.y - rect.top) / rect.height)
        );
        const style = this.surface.style;
        style.setProperty('--workspace-pointer-x', `${(x * 100).toFixed(2)}%`);
        style.setProperty('--workspace-pointer-y', `${(y * 100).toFixed(2)}%`);
        style.setProperty(
            '--workspace-tilt-x',
            `${((0.5 - y) * 14).toFixed(2)}deg`
        );
        style.setProperty(
            '--workspace-tilt-y',
            `${((x - 0.5) * 18).toFixed(2)}deg`
        );
        this.surface.setAttribute('data-workspace-pointer-active', '');
    };

    private readonly reset = (): void => {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        if (this.surface) {
            this.surface.removeAttribute('data-workspace-pointer-active');
            for (const property of [
                'pointer-x',
                'pointer-y',
                'tilt-x',
                'tilt-y',
            ]) {
                this.surface.style.removeProperty(`--workspace-${property}`);
            }
        }
        this.surface = null;
    };
}
