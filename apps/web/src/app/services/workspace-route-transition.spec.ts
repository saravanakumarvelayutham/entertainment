import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, ViewTransitionInfo } from '@angular/router';
import { SceneTransitionService } from '@iptvnator/ui/components';
import { transitionWorkspaceRoute } from './workspace-route-transition';

describe('workspace scene transitions', () => {
    let service: SceneTransitionService;
    let content: HTMLElement;
    const snapshot = (
        params: Record<string, string> = {},
        children: ActivatedRouteSnapshot[] = []
    ) =>
        ({
            params,
            children,
            url: Object.values(params).map((path) => ({
                toString: () => path,
            })),
        }) as ActivatedRouteSnapshot;
    const transition = () =>
        ({
            ready: Promise.resolve(),
            finished: new Promise<void>(() => undefined),
            skipTransition: jest.fn(),
        }) as unknown as ViewTransition;
    beforeEach(() => {
        service = TestBed.inject(SceneTransitionService);
        content = document.createElement('main');
        content.className = 'workspace-content';
        document.body.append(content);
        document.documentElement.dataset.workspaceMotion = 'full';
    });
    afterEach(() => {
        content.remove();
        delete document.documentElement.dataset.workspaceMotion;
        delete document.documentElement.dataset.workspaceScene;
        delete document.documentElement.dataset.workspaceTransitions;
    });
    it('reveals nested detail routes and reverses when returning', () => {
        const browse = snapshot();
        const detail = snapshot({}, [snapshot({ serialId: '42' })]);
        for (const [from, to, expected] of [
            [browse, snapshot({ section: 'sources' }), 'page'],
            [browse, detail, 'detail-open'],
            [detail, browse, 'detail-close'],
        ] as const) {
            TestBed.runInInjectionContext(() =>
                transitionWorkspaceRoute({
                    from,
                    to,
                    transition: transition(),
                } as ViewTransitionInfo)
            );
            expect(document.documentElement.dataset.workspaceScene).toBe(
                expected
            );
        }
    });
    it('skips snapshots for Reduced motion and active native playback', () => {
        document.documentElement.dataset.workspaceMotion = 'reduced';
        const reduced = transition();
        service.prepare(reduced, 'page');
        expect(reduced.skipTransition).toHaveBeenCalled();
        document.documentElement.dataset.workspaceMotion = 'full';
        content.classList.add('shell-host--watch');
        const playing = transition();
        service.prepare(playing, 'page');
        expect(playing.skipTransition).toHaveBeenCalled();
        expect(document.documentElement.dataset.workspaceScene).toBeUndefined();
    });
    it('does not replay a page transition for query/filter-only navigation', () => {
        const visual = transition();
        TestBed.runInInjectionContext(() =>
            transitionWorkspaceRoute({
                from: snapshot({ section: 'search' }),
                to: snapshot({ section: 'search' }),
                transition: visual,
            } as ViewTransitionInfo)
        );
        expect(visual.skipTransition).toHaveBeenCalled();
        expect(document.documentElement.dataset.workspaceScene).toBeUndefined();
    });

    it('updates synchronously when snapshots are unavailable', () => {
        const update = jest.fn();
        service.run('detail-open', update);
        expect(update).toHaveBeenCalledTimes(1);
    });
    it('does not let an interrupted scene clear a newer one', async () => {
        let finish!: () => void;
        const first = {
            ...transition(),
            finished: new Promise<void>((resolve) => {
                finish = resolve;
            }),
        } as ViewTransition;
        service.prepare(first, 'page');
        service.prepare(transition(), 'detail-open');
        expect(first.skipTransition).toHaveBeenCalled();
        finish();
        await Promise.resolve();
        await Promise.resolve();
        expect(document.documentElement.dataset.workspaceScene).toBe(
            'detail-open'
        );
    });
});
