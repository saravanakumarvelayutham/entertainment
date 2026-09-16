import { safeStorage } from 'electron';
import type { ElectronBridgeTmdbSettings } from '@iptvnator/shared/interfaces';
import { getDatabase } from '../database/connection';
import { databaseWorkerClient } from './database-worker-client';

const STORAGE_KEY = 'settings:tmdb:v1';

interface StoredTmdbSettings {
    version: 1;
    enabled: boolean;
    encryptedApiKey: string | null;
}

function parseStoredSettings(value: string): StoredTmdbSettings | null {
    try {
        const parsed = JSON.parse(value) as Partial<StoredTmdbSettings>;
        if (
            parsed.version !== 1 ||
            typeof parsed.enabled !== 'boolean' ||
            (parsed.encryptedApiKey !== null &&
                typeof parsed.encryptedApiKey !== 'string')
        ) {
            return null;
        }
        return parsed as StoredTmdbSettings;
    } catch {
        return null;
    }
}

async function readStoredValue(): Promise<string | null> {
    await getDatabase();
    return databaseWorkerClient.request<string | null>('DB_GET_APP_STATE', {
        key: STORAGE_KEY,
    });
}

export async function readSecureTmdbSettings(): Promise<ElectronBridgeTmdbSettings | null> {
    const value = await readStoredValue();
    if (!value) return null;

    const stored = parseStoredSettings(value);
    if (!stored) return null;

    if (!stored.encryptedApiKey) {
        return { enabled: stored.enabled, apiKey: '' };
    }
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure TMDB settings are unavailable on this device.');
    }

    return {
        enabled: stored.enabled,
        apiKey: safeStorage.decryptString(
            Buffer.from(stored.encryptedApiKey, 'base64')
        ),
    };
}

export async function writeSecureTmdbSettings(
    settings: ElectronBridgeTmdbSettings
): Promise<{ success: true }> {
    const apiKey = settings.apiKey.trim();
    if (apiKey && !safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure TMDB settings are unavailable on this device.');
    }

    const stored: StoredTmdbSettings = {
        version: 1,
        enabled: settings.enabled === true,
        encryptedApiKey: apiKey
            ? safeStorage.encryptString(apiKey).toString('base64')
            : null,
    };

    await getDatabase();
    await databaseWorkerClient.request('DB_SET_APP_STATE', {
        key: STORAGE_KEY,
        value: JSON.stringify(stored),
    });
    return { success: true };
}
