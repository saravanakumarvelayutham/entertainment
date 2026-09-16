const mockGetDatabase = jest.fn();
const mockRequest = jest.fn();
const mockEncryptString = jest.fn();
const mockDecryptString = jest.fn();
const mockIsEncryptionAvailable = jest.fn();

jest.mock('electron', () => ({
    safeStorage: {
        decryptString: mockDecryptString,
        encryptString: mockEncryptString,
        isEncryptionAvailable: mockIsEncryptionAvailable,
    },
}));

jest.mock('../database/connection', () => ({
    getDatabase: mockGetDatabase,
}));

jest.mock('./database-worker-client', () => ({
    databaseWorkerClient: { request: mockRequest },
}));

import {
    readSecureTmdbSettings,
    writeSecureTmdbSettings,
} from './tmdb-settings-vault';

describe('TMDB settings vault', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetDatabase.mockResolvedValue(undefined);
        mockIsEncryptionAvailable.mockReturnValue(true);
    });

    it('encrypts API keys before writing shared app state', async () => {
        mockEncryptString.mockReturnValue(Buffer.from('ciphertext'));
        mockRequest.mockResolvedValue({ success: true });

        await writeSecureTmdbSettings({
            enabled: true,
            apiKey: '  private-key  ',
        });

        expect(mockEncryptString).toHaveBeenCalledWith('private-key');
        const [, payload] = mockRequest.mock.calls[0];
        expect(mockRequest).toHaveBeenCalledWith(
            'DB_SET_APP_STATE',
            expect.objectContaining({ key: 'settings:tmdb:v1' })
        );
        expect(JSON.parse(payload.value)).toEqual({
            version: 1,
            enabled: true,
            encryptedApiKey: Buffer.from('ciphertext').toString('base64'),
        });
        expect(payload.value).not.toContain('private-key');
    });

    it('decrypts persisted settings without exposing ciphertext', async () => {
        mockRequest.mockResolvedValue(
            JSON.stringify({
                version: 1,
                enabled: true,
                encryptedApiKey: Buffer.from('ciphertext').toString('base64'),
            })
        );
        mockDecryptString.mockReturnValue('private-key');

        await expect(readSecureTmdbSettings()).resolves.toEqual({
            enabled: true,
            apiKey: 'private-key',
        });
        expect(mockDecryptString).toHaveBeenCalledWith(
            Buffer.from('ciphertext')
        );
    });

    it('rejects plaintext fallback when OS encryption is unavailable', async () => {
        mockIsEncryptionAvailable.mockReturnValue(false);

        await expect(
            writeSecureTmdbSettings({ enabled: true, apiKey: 'private-key' })
        ).rejects.toThrow('Secure TMDB settings are unavailable');
        expect(mockRequest).not.toHaveBeenCalled();
    });
});
