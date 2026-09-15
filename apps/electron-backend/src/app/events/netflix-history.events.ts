import { readFile } from 'node:fs/promises';
import { dialog, ipcMain } from 'electron';

const MAX_HISTORY_ENTRIES = 10_000;

function parseCsvRows(csv: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = '';
    let quoted = false;

    for (let index = 0; index < csv.length; index++) {
        const character = csv[index];
        if (quoted) {
            if (character === '"' && csv[index + 1] === '"') {
                value += '"';
                index++;
            } else if (character === '"') {
                quoted = false;
            } else value += character;
            continue;
        }
        if (character === '"') quoted = true;
        else if (character === ',') {
            row.push(value);
            value = '';
        } else if (character === '\n' || character === '\r') {
            if (character === '\r' && csv[index + 1] === '\n') index++;
            row.push(value);
            if (row.some((cell) => cell.length > 0)) rows.push(row);
            row = [];
            value = '';
        } else value += character;
    }
    row.push(value);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    return rows;
}

function parseNetflixViewingHistory(csv: string) {
    const [header, ...rows] = parseCsvRows(csv.replace(/^\uFEFF/, ''));
    const titleIndex = header?.findIndex(
        (cell) => cell.trim().toLocaleLowerCase() === 'title'
    );
    const dateIndex = header?.findIndex(
        (cell) => cell.trim().toLocaleLowerCase() === 'date'
    );
    if (titleIndex === undefined || titleIndex < 0 || dateIndex === undefined || dateIndex < 0) {
        throw new Error('This does not look like a Netflix viewing-history CSV.');
    }

    let skipped = 0;
    const entries = rows.flatMap((row) => {
        const title = row[titleIndex]?.trim();
        const watchedAt = row[dateIndex]?.trim();
        if (!title || !watchedAt || Number.isNaN(Date.parse(watchedAt))) {
            skipped++;
            return [];
        }
        return [{ title, watchedAt: new Date(watchedAt).toISOString() }];
    });
    if (entries.length === 0) throw new Error('The Netflix viewing-history CSV has no usable entries.');
    if (entries.length > MAX_HISTORY_ENTRIES) {
        return { entries: entries.slice(0, MAX_HISTORY_ENTRIES), skipped: skipped + entries.length - MAX_HISTORY_ENTRIES };
    }
    return { entries, skipped };
}

ipcMain.handle('IMPORT_NETFLIX_VIEWING_HISTORY', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Netflix viewing history', extensions: ['csv'] },
            { name: 'All files', extensions: ['*'] },
        ],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    const csv = await readFile(result.filePaths[0], 'utf8');
    return { cancelled: false, ...parseNetflixViewingHistory(csv) };
});
