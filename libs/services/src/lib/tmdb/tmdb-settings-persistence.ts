import type { Settings, TmdbSettings } from '@iptvnator/shared/interfaces';

function normalize(settings: Settings['tmdb']): {
    enabled: boolean;
    apiKey: string;
} {
    return {
        enabled: settings?.enabled === true,
        apiKey: settings?.apiKey?.trim() ?? '',
    };
}

export async function readDesktopTmdbSettings(): Promise<TmdbSettings | null> {
    try {
        return (await window.electron?.getSecureTmdbSettings?.()) ?? null;
    } catch (error) {
        console.warn('Could not restore secure desktop TMDB settings.', error);
        return null;
    }
}

export function migrateDesktopTmdbSettings(settings: TmdbSettings): void {
    void window.electron
        ?.setSecureTmdbSettings?.(normalize(settings))
        .catch((error) =>
            console.warn('Could not migrate desktop TMDB settings.', error)
        );
}

export async function saveDesktopTmdbSettings(
    settings: Settings['tmdb']
): Promise<void> {
    if (window.electron?.setSecureTmdbSettings) {
        await window.electron.setSecureTmdbSettings(normalize(settings));
    }
}
