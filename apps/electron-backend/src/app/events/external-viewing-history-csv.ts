const MAX_HISTORY_ENTRIES = 10_000;

export interface ParsedViewingHistory {
    readonly entries: Array<{ title: string; watchedAt: string }>;
    readonly skipped: number;
}

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
            } else if (character === '"') quoted = false;
            else value += character;
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

function findHeaderIndex(header: readonly string[], name: string): number {
    return header.findIndex(
        (cell) => cell.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
    );
}

/**
 * Retains only title and start date from locally selected provider exports.
 * Prime Video uses an explicit UTC timestamp, while Netflix uses `Date`.
 */
export function parseExternalViewingHistory(csv: string): ParsedViewingHistory {
    const [header, ...rows] = parseCsvRows(csv.replace(/^\uFEFF/, ''));
    const titleIndex = header ? findHeaderIndex(header, 'Title') : -1;
    const netflixDateIndex = header ? findHeaderIndex(header, 'Date') : -1;
    const primeDateIndex = header
        ? findHeaderIndex(header, 'Playback Start Datetime (UTC)')
        : -1;
    const dateIndex = netflixDateIndex >= 0 ? netflixDateIndex : primeDateIndex;

    if (titleIndex < 0 || dateIndex < 0) {
        throw new Error(
            'This does not look like a Netflix or Prime Video viewing-history CSV.'
        );
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
    if (entries.length === 0) {
        throw new Error('The viewing-history CSV has no usable entries.');
    }
    if (entries.length > MAX_HISTORY_ENTRIES) {
        return {
            entries: entries.slice(0, MAX_HISTORY_ENTRIES),
            skipped: skipped + entries.length - MAX_HISTORY_ENTRIES,
        };
    }
    return { entries, skipped };
}
