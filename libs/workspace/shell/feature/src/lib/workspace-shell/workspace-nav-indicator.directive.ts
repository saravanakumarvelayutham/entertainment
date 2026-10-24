import {
    AfterViewInit,
    Directive,
    ElementRef,
    inject,
    NgZone,
    OnDestroy,
} from '@angular/core';

/** The marker follows the actual active link, including responsive label changes. */
@Directive({ selector: '[appWorkspaceNavIndicator]' })
export class WorkspaceNavIndicatorDirective
    implements AfterViewInit, OnDestroy
{
    private readonly host =
        inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    private readonly zone = inject(NgZone);
    private observer?: MutationObserver;
    private resize?: ResizeObserver;
    private frame: number | null = null;

    ngAfterViewInit(): void {
        this.zone.runOutsideAngular(() => {
            this.observer = new MutationObserver(this.schedule);
            this.observer.observe(this.host, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['aria-current', 'class'],
            });
            this.resize = new ResizeObserver(this.schedule);
            this.resize.observe(this.host);
            this.schedule();
        });
    }

    ngOnDestroy(): void {
        this.observer?.disconnect();
        this.resize?.disconnect();
        if (this.frame !== null) cancelAnimationFrame(this.frame);
    }

    private readonly schedule = (): void => {
        this.frame ??= requestAnimationFrame(() => {
            this.frame = null;
            for (const nav of this.host.querySelectorAll<HTMLElement>(
                '.global-links .rail-links'
            )) {
                // RouterLinkActive owns the visual selection. Desktop route
                // completion can precede the template's aria-current update.
                const active =
                    nav.querySelector<HTMLElement>(
                        '.portal-rail-link.is-active, .portal-rail-link.active'
                    ) ??
                    nav.querySelector<HTMLElement>('[aria-current="page"]');
                if (!active) {
                    nav.removeAttribute('data-workspace-nav-ready');
                    continue;
                }
                const rect = active.getBoundingClientRect();
                const parent = nav.getBoundingClientRect();
                nav.style.setProperty(
                    '--workspace-nav-x',
                    `${rect.left - parent.left + nav.scrollLeft}px`
                );
                nav.style.setProperty(
                    '--workspace-nav-width',
                    `${rect.width}px`
                );
                nav.setAttribute('data-workspace-nav-ready', '');
            }
        });
    };
}
