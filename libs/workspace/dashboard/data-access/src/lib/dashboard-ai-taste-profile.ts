import type { DatabaseService } from '@iptvnator/services';
import { MAX_AI_TASTE_SUMMARY_LENGTH } from '@iptvnator/shared/interfaces';

const STORAGE_KEY = 'recommendations:ai-taste-profile:v1';
interface TasteProfile {
    fingerprint: string;
    summary: string;
}

/** One local profile; its evidence/config fingerprint prevents cross-profile reuse. */
export class DashboardAiTasteProfile {
    private profile: TasteProfile | null = null;
    private loadPromise: Promise<void> | null = null;
    private mutationQueue: Promise<void> = Promise.resolve();

    constructor(
        private readonly database: Pick<
            DatabaseService,
            'getAppStateOrThrow' | 'setAppState'
        >
    ) {}

    async read(fingerprint: string): Promise<string | null> {
        if (this.profile)
            return this.profile.fingerprint === fingerprint
                ? this.profile.summary
                : null;
        this.loadPromise ??= this.load();
        await this.loadPromise;
        const profile = this.currentProfile();
        return profile?.fingerprint === fingerprint ? profile.summary : null;
    }

    private currentProfile(): TasteProfile | null {
        return this.profile;
    }

    async save(fingerprint: string, summary: string): Promise<void> {
        const profile = { fingerprint, summary };
        const write = this.mutationQueue.then(async () => {
            if (
                !(await this.database.setAppState(
                    STORAGE_KEY,
                    JSON.stringify(profile)
                ))
            )
                throw new Error('AI taste profile could not be saved.');
            this.profile = profile;
        });
        this.mutationQueue = write.catch(() => undefined);
        await write;
    }

    private async load(): Promise<void> {
        try {
            const value = await this.database.getAppStateOrThrow(STORAGE_KEY);
            if (!value) return;
            const profile = JSON.parse(value) as TasteProfile;
            if (
                typeof profile.fingerprint === 'string' &&
                typeof profile.summary === 'string' &&
                profile.summary.trim() &&
                profile.summary.length <= MAX_AI_TASTE_SUMMARY_LENGTH
            )
                this.profile = profile;
        } catch {
            throw new Error('AI taste profile could not be loaded.');
        }
    }
}
