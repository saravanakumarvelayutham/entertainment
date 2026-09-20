import { readFile } from 'node:fs/promises';
import { dialog, ipcMain } from 'electron';
import { parseExternalViewingHistory } from './external-viewing-history-csv';


ipcMain.handle('IMPORT_NETFLIX_VIEWING_HISTORY', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Netflix or Prime Video viewing history', extensions: ['csv'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    const csv = await readFile(result.filePaths[0], 'utf8');
    return { cancelled: false, ...parseExternalViewingHistory(csv) };
});
