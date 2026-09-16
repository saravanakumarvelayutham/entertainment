import { Injectable, inject, signal } from '@angular/core';
import { DatabaseService } from '@iptvnator/services';

export interface ExternalWatchHistoryEntry {
    readonly title: string;
    readonly watchedAt: string;
}

const STORAGE_KEY = 'recommendations:external-watch-history:v1';
const MAX_ENTRIES = 10_000;

/** Local-only history imported from providers that do not expose playback state. */
@Injectable({ providedIn: 'root' })
export class ExternalWatchHistoryService {
    private readonly database = inject(DatabaseService);
    private loaded = false;
    private loadPromise: Promise<void> | null = null;
    readonly entries = signal<readonly ExternalWatchHistoryEntry[]>([]);
    readonly importedAt = signal<string | null>(null);

    async load(): Promise<void> {
        if (this.loaded) return;
        if (this.loadPromise) return this.loadPromise;

        const loadPromise = this.loadPersistedHistory();
        this.loadPromise = loadPromise;
        try {
            await loadPromise;
            this.loaded = true;
        } finally {
            if (this.loadPromise === loadPromise) this.loadPromise = null;
        }
    }

    private async loadPersistedHistory(): Promise<void> {
        const value = await this.database.getAppStateOrThrow(STORAGE_KEY);
        if (!value) return;
        try {
            const parsed = JSON.parse(value) as {
                entries?: unknown;
                importedAt?: unknown;
            };
            if (!Array.isArray(parsed.entries)) return;
            this.entries.set(
                parsed.entries
                    .filter(this.isEntry)
                    .slice(0, MAX_ENTRIES)
                    .sort((left, right) =>
                        right.watchedAt.localeCompare(left.watchedAt)
                    )
            );
            this.importedAt.set(
                typeof parsed.importedAt === 'string' ? parsed.importedAt : null
            );
        } catch {
            // A malformed local value must not prevent the dashboard loading.
        }
    }

    async importNetflix(): Promise<{
        imported: number;
        skipped: number;
    } | null> {
        if (typeof window.electron?.importNetflixViewingHistory !== 'function')
            return null;
        // Do not let a slower startup read overwrite a newer import in memory.
        await this.load().catch(() => undefined);
        const result = await window.electron.importNetflixViewingHistory();
        if (result.cancelled) return null;
        const deduped = [
            ...new Map(
                result.entries.map((entry) => [
                    `${entry.title}\u0000${entry.watchedAt}`,
                    entry,
                ])
            ).values(),
        ]
            .filter(this.isEntry)
            .slice(0, MAX_ENTRIES)
            .sort((left, right) =>
                right.watchedAt.localeCompare(left.watchedAt)
            );
        const importedAt = new Date().toISOString();
        const saved = await this.database.setAppState(
            STORAGE_KEY,
            JSON.stringify({ source: 'netflix', importedAt, entries: deduped })
        );
        if (!saved)
            throw new Error('SaravTV could not save the imported history.');
        this.loaded = true;
        this.entries.set(deduped);
        this.importedAt.set(importedAt);
        return { imported: deduped.length, skipped: result.skipped };
    }

    private isEntry(value: unknown): value is ExternalWatchHistoryEntry {
        if (!value || typeof value !== 'object') return false;
        const entry = value as ExternalWatchHistoryEntry;
        return (
            typeof entry.title === 'string' &&
            entry.title.trim().length > 0 &&
            typeof entry.watchedAt === 'string' &&
            !Number.isNaN(Date.parse(entry.watchedAt))
        );
    }
}
