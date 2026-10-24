import { SubtitleMatch, SubtitleSearchQuery } from './subtitle-contracts';

interface ReleaseEvidence {
    source: string | null;
    resolution: string | null;
    codec: string | null;
    group: string | null;
}

function evidence(value: string): ReleaseEvidence {
    value = value.replace(/_/g, '.');
    const sourcePatterns: [string, RegExp][] = [
        ['webdl', /\bweb[ ._-]?dl\b/i],
        ['webrip', /\bweb[ ._-]?rip\b/i],
        ['bluray', /\bblu[ ._-]?ray\b/i],
        ['bdrip', /\bb[dr]rip\b/i],
        ['hdtv', /\bhdtv\b/i],
        ['dvd', /\bdvd(?:rip)?\b/i],
    ];
    const source =
        sourcePatterns.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
    const resolution =
        /\b(4320|2160|1080|720|576|480)p\b/i.exec(value)?.[1] ?? null;
    const codecToken = /\b([xh][ ._-]?26[45]|hevc|avc|av1)\b/i
        .exec(value)?.[1]
        ?.toLowerCase()
        .replace(/[ ._-]/g, '');
    const codec = codecToken
        ? /265|hevc/.test(codecToken)
            ? 'h265'
            : /264|avc/.test(codecToken)
              ? 'h264'
              : 'av1'
        : null;
    // A hyphen in an ordinary title (e.g. Spider-Man) is not group evidence.
    const groupToken =
        source || resolution || codec
            ? (/-([a-z\d]{2,24})(?:\.(?:srt|vtt))?$/i
                  .exec(value.trim())?.[1]
                  ?.toLowerCase() ?? null)
            : null;
    const group =
        groupToken && !/^(?:dl|rip|ray|avc|hevc|[xh]26[45])$/.test(groupToken)
            ? groupToken
            : null;
    return { source, resolution, codec, group };
}

function withoutTitle(release: string, title: string): string {
    const words = title
        .toLowerCase()
        .split(/[^a-z\d]+/)
        .filter(Boolean);
    const titleWords: string[] = [];
    for (const word of words) {
        if (
            /^(?:19\d\d|20\d\d|s\d{1,3}e\d{1,4}|\d{3,4}p|web|webrip|webdl|bluray|hdtv|[xh]26[45])$/.test(
                word
            )
        )
            break;
        titleWords.push(word);
    }
    const normalized = release
        .toLowerCase()
        .split(/[^a-z\d]+/)
        .filter(Boolean);
    return titleWords.length &&
        titleWords.every((word, index) => normalized[index] === word)
        ? normalized.slice(titleWords.length).join('.')
        : release.toLowerCase();
}

function unsuitableRelease(value: string, title: string): boolean {
    const details = withoutTitle(value, title);
    if (
        /\b(?:hdcam|camrip|cam|hdts|telesync|telecine|tc|dvdscr|screener|scr)\b/i.test(
            details
        )
    )
        return true;
    // A trailing .ts can be a media transport extension, not a telesync release.
    return /\bts[ ._-]+(?!srt\b|vtt\b|mp4\b|mkv\b)[a-z\d]/i.test(details);
}

function episodeCompatible(value: string, query: SubtitleSearchQuery): boolean {
    value = value.replace(/_/g, '.');
    if (
        query.type !== 'series' ||
        query.season === undefined ||
        query.episode === undefined
    )
        return true;
    const pattern =
        /\bs(\d{1,3})[ ._-]*e(\d{1,4})((?:[ ._-]*e\d{1,4})*)\b|\b(\d{1,3})x(\d{1,4})\b/gi;
    let tag: RegExpExecArray | null;
    let hasEpisode = false;
    while ((tag = pattern.exec(value))) {
        hasEpisode = true;
        if (Number(tag[1] ?? tag[4]) !== query.season) continue;
        const episodes = [Number(tag[2] ?? tag[5])];
        const additional = /e(\d{1,4})/gi;
        let extra: RegExpExecArray | null;
        while ((extra = additional.exec(tag[3] ?? '')))
            episodes.push(Number(extra[1]));
        if (episodes.includes(query.episode)) return true;
    }
    if (hasEpisode) return false;
    const season = /\bs(?:eason[ ._-]*)?(\d{1,3})\b/i.exec(value);
    return !season || Number(season[1]) === query.season;
}

function scoreRelease(
    release: string,
    hint: ReleaseEvidence,
    query: SubtitleSearchQuery
): number {
    let score = 0;
    const details = withoutTitle(release, query.title).replace(
        /\b(?:non|not)[ ._-]+forced\b/gi,
        ''
    );
    if (unsuitableRelease(release, query.title)) score -= 2000;
    if (
        /\b(?:forced|incomplete|partial)\b/i.test(details) ||
        /\bforeign[ ._-]+(?:parts|only)\b/i.test(details)
    )
        score -= 1000;
    const actual = evidence(release);
    const weights = { group: 120, source: 80, resolution: 40, codec: 10 };
    for (const field of Object.keys(weights) as (keyof ReleaseEvidence)[]) {
        if (hint[field] && actual[field]) {
            score +=
                hint[field] === actual[field]
                    ? weights[field]
                    : -weights[field] / 2;
        }
    }
    return score;
}

/** Uses explicit release evidence only; provider ordering breaks all score ties. */
export function rankEnglishSubtitleReleases(
    matches: readonly SubtitleMatch[],
    queryOrHint: SubtitleSearchQuery | string,
    releaseHint?: string
): SubtitleMatch[] {
    const query: SubtitleSearchQuery =
        typeof queryOrHint === 'string'
            ? { title: '', type: 'movie' }
            : queryOrHint;
    const hint = evidence(
        releaseHint ??
            (typeof queryOrHint === 'string' ? queryOrHint : query.title)
    );
    return matches
        .filter((match) => episodeCompatible(match.release, query))
        .map((match, index) => ({
            match,
            index,
            score: scoreRelease(match.release, hint, query),
        }))
        .sort(
            (left, right) =>
                right.score - left.score || left.index - right.index
        )
        .map(({ match }) => match);
}
