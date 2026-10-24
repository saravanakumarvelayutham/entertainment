import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, ViewTransitionInfo } from '@angular/router';
import { SceneTransitionService } from '@iptvnator/ui/components';

function isDetail(route: ActivatedRouteSnapshot): boolean {
    return (
        Object.keys(route.params).some((key) =>
            /^(vodId|serialId|seriesId|movieId|episodeId|downloadId|recordingId)$/.test(
                key
            )
        ) || route.children.some(isDetail)
    );
}

function scenePath(route: ActivatedRouteSnapshot): string {
    return [
        route.url.map((segment) => segment.toString()).join('/'),
        ...route.children.map(scenePath),
    ].join('/');
}

export function transitionWorkspaceRoute(info: ViewTransitionInfo): void {
    // Query/filter changes update the current scene rather than replacing it.
    if (scenePath(info.from) === scenePath(info.to)) {
        info.transition.skipTransition();
        return;
    }
    const scene = isDetail(info.to)
        ? 'detail-open'
        : isDetail(info.from)
          ? 'detail-close'
          : 'page';
    inject(SceneTransitionService).prepare(info.transition, scene);
}
