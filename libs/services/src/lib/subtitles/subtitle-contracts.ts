export interface SubtitleSearchQuery {
    title: string;
    type: 'movie' | 'series';
    year?: number;
    season?: number;
    episode?: number;
}

export interface SubtitleTitleMatch {
    imdbId: string;
    title: string;
    year: number | null;
    type: 'movie' | 'series';
}

export interface SubtitleMatch {
    id: string;
    label: string;
    release: string;
    url: string;
}

export interface DownloadedSubtitle {
    name: string;
    format: 'srt' | 'vtt';
    content: string;
}

export const IMDB_ID = /^tt\d{5,12}$/;

export function subtitleDownloadUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' &&
            /^subs\d+\.strem\.io$/.test(url.hostname) &&
            !url.username &&
            !url.password &&
            !url.port &&
            !url.search &&
            !url.hash &&
            /^\/en\/download\/subencoding-stremio-utf8\/src-api\/file\/\d+$/.test(
                url.pathname
            )
            ? url.href
            : null;
    } catch {
        return null;
    }
}

export function subtitleLabel(value: unknown): string {
    return typeof value === 'string'
        ? value
              .replace(/\p{Cc}/gu, ' ')
              .trim()
              .slice(0, 200)
        : '';
}
