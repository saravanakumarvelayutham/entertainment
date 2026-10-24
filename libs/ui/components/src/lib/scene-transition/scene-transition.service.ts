import { DOCUMENT } from '@angular/common';
import {
    afterNextRender,
    inject,
    Injectable,
    Injector,
    NgZone,
} from '@angular/core';

export type WorkspaceScene = 'page' | 'detail-open' | 'detail-close';

/** Connects scenes with snapshots, without moving or duplicating live players. */
@Injectable({ providedIn: 'root' })
export class SceneTransitionService {
    private readonly document = inject(DOCUMENT);
    private readonly injector = inject(Injector);
    private readonly zone = inject(NgZone);
    private active?: ViewTransition;

    enabled(): boolean {
        const mode = this.document.documentElement.dataset.workspaceMotion;
        const reduced = this.document.defaultView?.matchMedia?.(
            '(prefers-reduced-motion: reduce)'
        ).matches;
        return (
            mode !== 'reduced' &&
            (mode === 'full' || !reduced) &&
            !!this.document.querySelector('.workspace-content') &&
            !this.document.querySelector('.shell-host--watch') &&
            !Array.from(this.document.querySelectorAll('video')).some(
                (video) =>
                    video.currentSrc && video.getBoundingClientRect().width > 0
            )
        );
    }

    /** Angular's router owns the render transaction for routed navigation. */
    prepare(transition: ViewTransition, scene: WorkspaceScene): void {
        this.active?.skipTransition();
        if (!this.enabled()) {
            transition.skipTransition();
            return;
        }
        this.active = transition;
        this.document.documentElement.dataset.workspaceTransitions = 'ready';
        this.document.documentElement.dataset.workspaceScene = scene;
        // Interrupting a visual transition must never cancel its state update.
        void transition.ready.catch(() => undefined);
        void transition.finished
            .catch(() => undefined)
            .then(() => {
                if (this.active !== transition) return;
                this.active = undefined;
                delete this.document.documentElement.dataset.workspaceScene;
            });
    }

    /** Collections open details in-place, without activating a new route. */
    run(scene: WorkspaceScene, update: () => void): void {
        if (!this.document.startViewTransition || !this.enabled()) {
            update();
            return;
        }
        this.active?.skipTransition();
        const transition = this.document.startViewTransition(() =>
            this.zone.run(
                () =>
                    new Promise<void>((resolve) => {
                        afterNextRender(() => resolve(), {
                            injector: this.injector,
                        });
                        update();
                    })
            )
        );
        this.prepare(transition, scene);
    }
}
