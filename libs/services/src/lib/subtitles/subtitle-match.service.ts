import { Injectable } from '@angular/core';
import {
    DownloadedSubtitle,
    IMDB_ID,
    SubtitleMatch,
    SubtitleSearchQuery,
    SubtitleTitleMatch,
    subtitleDownloadUrl,
    subtitleLabel,
} from './subtitle-contracts';
import { subtitleProviderRequest } from './subtitle-provider-request';

const JSON_LIMIT = 1024 * 1024;
const SUBTITLE_LIMIT = 2 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function validateQuery(query: SubtitleSearchQuery): void {
    if (
        !query ||
        !['movie', 'series'].includes(query.type) ||
        !subtitleLabel(query.title) ||
        query.title.length > 200 ||
        query.title.includes('://') ||
        /\p{Cc}/u.test(query.title) ||
        (query.year !== undefined &&
            (!Number.isInteger(query.year) ||
                query.year < 1800 ||
                query.year > 2200))
    ) {
        throw new Error('Enter a valid movie or series title.');
    }
}

/** Sends only explicitly supplied public title/episode metadata to fixed providers. */
@Injectable({ providedIn: 'root' })
export class SubtitleMatchService {
    async searchTitles(
        query: SubtitleSearchQuery,
        signal?: AbortSignal
    ): Promise<SubtitleTitleMatch[]> {
        validateQuery(query);
        if (signal?.aborted) throw new Error('Subtitle request cancelled.');
        const title = query.title.trim();
        if (IMDB_ID.test(title)) {
            return [
                {
                    imdbId: title,
                    title,
                    year: query.year ?? null,
                    type: query.type,
                },
            ];
        }
        const response: unknown = JSON.parse(
            await subtitleProviderRequest(
                `https://v3-cinemeta.strem.io/catalog/${query.type}/top/search=${encodeURIComponent(title)}.json`,
                JSON_LIMIT,
                signal
            )
        );
        const metas = object(response)?.['metas'];
        if (!Array.isArray(metas))
            throw new Error('Invalid title search response.');
        const matches: SubtitleTitleMatch[] = [];
        const seen = new Set<string>();
        for (const item of metas) {
            const row = object(item);
            if (
                !row ||
                row['type'] !== query.type ||
                typeof row['id'] !== 'string' ||
                !IMDB_ID.test(row['id']) ||
                seen.has(row['id'])
            )
                continue;
            const name = subtitleLabel(row['name']);
            if (!name) continue;
            seen.add(row['id']);
            const rawYear = row['releaseInfo'] ?? row['year'];
            const yearText =
                typeof rawYear === 'string' || typeof rawYear === 'number'
                    ? String(rawYear)
                    : '';
            const yearMatch = /^(\d{4})(?:\D|$)/.exec(yearText);
            const parsedYear = yearMatch ? Number(yearMatch[1]) : 0;
            const year =
                parsedYear >= 1800 && parsedYear <= 2200 ? parsedYear : null;
            matches.push({
                imdbId: row['id'],
                title: name,
                year,
                type: query.type,
            });
            if (matches.length === 20) break;
        }
        return matches;
    }

    async findEnglish(
        match: SubtitleTitleMatch,
        query: SubtitleSearchQuery,
        signal?: AbortSignal
    ): Promise<SubtitleMatch[]> {
        validateQuery(query);
        if (!IMDB_ID.test(match.imdbId) || match.type !== query.type)
            throw new Error('Invalid title match.');
        let videoId = match.imdbId;
        if (query.type === 'series') {
            if (
                typeof query.season !== 'number' ||
                !Number.isInteger(query.season) ||
                query.season < 0 ||
                query.season > 1000 ||
                typeof query.episode !== 'number' ||
                !Number.isInteger(query.episode) ||
                query.episode < 1 ||
                query.episode > 10000
            ) {
                throw new Error(
                    'Choose a season and episode for series subtitles.'
                );
            }
            videoId += `:${query.season}:${query.episode}`;
        }
        const response: unknown = JSON.parse(
            await subtitleProviderRequest(
                `https://opensubtitles-v3.strem.io/subtitles/${query.type}/${videoId}.json`,
                JSON_LIMIT,
                signal
            )
        );
        const subtitles = object(response)?.['subtitles'];
        if (!Array.isArray(subtitles))
            throw new Error('Invalid subtitle search response.');
        const matches: SubtitleMatch[] = [];
        const seen = new Set<string>();
        for (const item of subtitles) {
            const row = object(item);
            if (!row || !['eng', 'en'].includes(String(row['lang']))) continue;
            const url = subtitleDownloadUrl(row['url']);
            const id = subtitleLabel(row['id']);
            if (!url || !id || seen.has(id)) continue;
            seen.add(id);
            const release =
                subtitleLabel(row['movieReleaseName']) ||
                subtitleLabel(row['subtitleFileName']);
            matches.push({
                id,
                url,
                release,
                label: release || `English (${id})`,
            });
            if (matches.length === 20) break;
        }
        return matches;
    }

    async download(
        match: SubtitleMatch,
        signal?: AbortSignal
    ): Promise<DownloadedSubtitle> {
        const url = subtitleDownloadUrl(match.url);
        if (!url) throw new Error('Invalid subtitle download URL.');
        const content = (
            await subtitleProviderRequest(url, SUBTITLE_LIMIT, signal)
        ).replace(/^\uFEFF/, '');
        const format = /^WEBVTT(?:\s|$)/.test(content)
            ? 'vtt'
            : /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(
                    content
                )
              ? 'srt'
              : null;
        if (!format || /^\s*<!?(?:doctype|html)/i.test(content))
            throw new Error('Invalid subtitle file.');
        const name = (
            subtitleLabel(match.release || match.label).replace(
                /[<>:"/\\|?*]/g,
                '_'
            ) || 'English subtitles'
        ).replace(/\.(?:srt|vtt)$/i, '');
        return { name: `${name}.${format}`, format, content };
    }
}
