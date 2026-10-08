import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import {
    AI_RECOMMENDATIONS_RANK,
    AI_RECOMMENDATIONS_STATUS,
} from '@iptvnator/shared/interfaces';
import { registerAiRecommendationHandlers } from './ai-recommendations.events';
import { rankAiRecommendations } from '../services/ai-recommendations.service';

jest.mock('electron', () => ({ ipcMain: { handle: jest.fn() } }));
jest.mock('../services/ai-recommendations.service', () => ({
    rankAiRecommendations: jest.fn(),
}));

describe('AI recommendation IPC boundary', () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const getHandler = (channel: string) => {
        const handler = handlers.get(channel);
        if (!handler) throw new Error('Missing handler');
        return handler;
    };
    const mainFrame = {};
    const webContents = { mainFrame };
    const window = { webContents, isDestroyed: () => false };
    const sender = { sender: webContents, senderFrame: mainFrame };
    beforeEach(() => {
        jest.clearAllMocks();
        handlers.clear();
        (ipcMain.handle as jest.Mock).mockImplementation((channel, handler) =>
            handlers.set(channel, handler)
        );
        registerAiRecommendationHandlers(
            () => window as unknown as BrowserWindow
        );
    });
    it('rejects other windows and subframes before reading status or ranking', () => {
        for (const channel of [
            AI_RECOMMENDATIONS_STATUS,
            AI_RECOMMENDATIONS_RANK,
        ]) {
            const handler = getHandler(channel);
            expect(() => handler({ ...sender, sender: {} })).toThrow(
                'unavailable'
            );
            expect(() => handler({ ...sender, senderFrame: {} })).toThrow(
                'unavailable'
            );
        }
        expect(rankAiRecommendations).not.toHaveBeenCalled();
    });
    it('exposes only token availability to the main renderer', () => {
        const original = process.env.MODELS_AUTH_TOKEN;
        try {
            process.env.MODELS_AUTH_TOKEN = 'secret';
            expect(getHandler(AI_RECOMMENDATIONS_STATUS)(sender)).toEqual({
                available: true,
            });
            delete process.env.MODELS_AUTH_TOKEN;
            expect(getHandler(AI_RECOMMENDATIONS_STATUS)(sender)).toEqual({
                available: false,
            });
        } finally {
            if (original === undefined) delete process.env.MODELS_AUTH_TOKEN;
            else process.env.MODELS_AUTH_TOKEN = original;
        }
    });
    it('passes ranking through the trusted sender boundary', () => {
        const request = { model: 'security' };
        getHandler(AI_RECOMMENDATIONS_RANK)(
            sender as unknown as IpcMainInvokeEvent,
            request
        );
        expect(rankAiRecommendations).toHaveBeenCalledWith(request);
    });
});
