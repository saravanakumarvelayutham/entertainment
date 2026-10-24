import type {
    SubtitleSearchQuery,
    SubtitleTitleMatch,
} from '@iptvnator/services';
import type { PlayerMediaTitle } from '../player-controls/player-controls.model';

export function subtitleQueryForTitle(
    media: PlayerMediaTitle | null
): SubtitleSearchQuery {
    const primary = media?.primary.trim() ?? '';
    const metadataYear = media?.year;
    const episode = `${primary} ${media?.secondary ?? ''}`.match(
        /\bS(\d{1,3})\s*E(\d{1,4})\b|\b(\d{1,3})x(\d{1,4})\b/i
    );
    const release =
        /\b(?:2160p|1080p|720p|480p|4k|uhd|web[ ._-]?dl|webrip|blu[ ._-]?ray|b[dr]rip|hdtv|[xh]26[45]|hevc)\b/i;
    const withoutRelease = primary
        .split(release, 1)[0]
        .replace(/[\s.\-[]+$/, '')
        .trim();
    const titleText = release.test(primary)
        ? withoutRelease.replace(/\./g, ' ')
        : primary;
    const year =
        titleText.match(/[([]((?:19|20)\d{2})[)\]]/) ??
        titleText.match(/\S.+?[\s.]((?:19|20)\d{2})$/);
    return {
        title: titleText
            .replace(/[([](?:19|20)\d{2}[)\]]/, '')
            .replace(year ? new RegExp(`[\\s.]+${year[1]}$`) : /$^/, '')
            .replace(/\bS\d{1,3}\s*E\d{1,4}\b.*|\b\d{1,3}x\d{1,4}\b.*/i, '')
            .replace(/[\s.\-–:]+$/, '')
            .trim(),
        type: episode ? 'series' : 'movie',
        ...(metadataYear !== undefined &&
        Number.isInteger(metadataYear) &&
        metadataYear >= 1800 &&
        metadataYear <= 2200
            ? { year: metadataYear }
            : year
              ? { year: Number(year[1]) }
              : {}),
        ...(episode
            ? {
                  season: Number(episode[1] ?? episode[3]),
                  episode: Number(episode[2] ?? episode[4]),
              }
            : {}),
    };
}

const normalize = (value: string) =>
    value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');

/** Ambiguous remakes require a year or explicit title selection. */
export function confidentSubtitleTitle(
    matches: SubtitleTitleMatch[],
    query: SubtitleSearchQuery
): SubtitleTitleMatch | null {
    const exact = matches.filter(
        (match) =>
            match.type === query.type &&
            (normalize(match.title) === normalize(query.title) ||
                match.imdbId === query.title) &&
            (query.year === undefined || match.year === query.year)
    );
    return exact.length === 1 ? exact[0] : null;
}
