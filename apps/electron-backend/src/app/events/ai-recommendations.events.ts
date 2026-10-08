import { BrowserWindow, IpcMainInvokeEvent, ipcMain } from 'electron';
import {
    AI_RECOMMENDATIONS_RANK,
    AI_RECOMMENDATIONS_STATUS,
} from '@iptvnator/shared/interfaces';
import { rankAiRecommendations } from '../services/ai-recommendations.service';

export function registerAiRecommendationHandlers(
    getMainWindow: () => BrowserWindow | undefined
): void {
    const assertSender = (event: IpcMainInvokeEvent) => {
        const window = getMainWindow();
        if (
            !window ||
            window.isDestroyed() ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame
        ) {
            throw new Error('AI recommendations are unavailable.');
        }
    };
    ipcMain.handle(AI_RECOMMENDATIONS_STATUS, (event) => {
        assertSender(event);
        return { available: Boolean(process.env.MODELS_AUTH_TOKEN?.trim()) };
    });
    ipcMain.handle(AI_RECOMMENDATIONS_RANK, (event, request: unknown) => {
        assertSender(event);
        return rankAiRecommendations(request);
    });
}
