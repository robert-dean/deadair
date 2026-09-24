import type { PlaylistImportEntryInput, PlaylistImportEntrySource } from './playlist.import.planner.js';

/** The plain-text shapes a playlist arrives in from outside deadair. */
export type PlaylistTextFormat = 'm3u' | 'csv' | 'text';

/** What a list is called when nothing in it, or about it, says. */
const UNNAMED = 'Imported playlist';

/**
 * A playlist somebody else's software wrote, read into the entries every source shares.
 *
 * Three shapes, because they are what people actually have: an M3U from a media player, a CSV from a
 * playlist exporter (Exportify's columns are the model, and the usual alternatives are recognised),
 * and a plain list of `Artist - Title` lines pasted from anywhere. None of them names a provider's
 * copy, so every entry is matched by its words, and a line that names no record is counted rather
 * than guessed at: a guess is a placeholder for a record nobody meant.
 *
 * @param format - Absent detects it from the text, which is right for every file these three kinds
 *   of software write.
 * @param fileName - Names the playlist when the text does not, without its extension.
 */
export function parsePlaylistText(text: string, format?: PlaylistTextFormat, fileName?: string): PlaylistImportEntrySource {
    const shape = format ?? detectFormat(text);
    const fallbackName = nameFromFile(fileName) ?? UNNAMED;

    if (shape === 'm3u') return readM3u(text, fallbackName);
    if (shape === 'csv') return readCsv(text, fallbackName);
    return readLines(text, fallbackName);
}

/** Which of the three shapes this text is. */
export function detectFormat(text: string): PlaylistTextFormat {
    const head = text.replace(/^\uFEFF/, '').trimStart();
    if (head.startsWith('#EXTM3U') || /^#EXTINF:/m.test(head)) return 'm3u';

    const firstLine = head.split(/\r?\n/, 1)[0] ?? '';
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    const header = splitCsvLine(firstLine, delimiter).map(normalizeHeader);
    if (header.some(cell => TITLE_HEADERS.includes(cell)) && header.some(cell => ARTIST_HEADERS.includes(cell))) return 'csv';

    return 'text';
}

/**
 * An M3U or M3U8.
 *
 * `#EXTINF` carries the duration and an `Artist - Title` display string, which is the only part of
 * an entry that names a record: the location beneath it is a path on somebody else's disk or a URL
 * on somebody else's server. When there is no `#EXTINF`, the file name is tried as the same string,
 * with its extension and any leading track number taken off.
 */
function readM3u(text: string, fallbackName: string): PlaylistImportEntrySource {
    const entries: PlaylistImportEntryInput[] = [];
    let name: string | undefined;
    let skipped = 0;
    let pending: { display: string; durationMs?: number } | undefined;

    for (const raw of lines(text)) {
        const line = raw.trim();
        if (line.length === 0) continue;

        if (line.startsWith('#PLAYLIST:')) {
            name = line.slice('#PLAYLIST:'.length).trim() || name;
            continue;
        }
        if (line.startsWith('#EXTINF:')) {
            const body = line.slice('#EXTINF:'.length);
            const comma = body.indexOf(',');
            const seconds = Number.parseFloat(comma < 0 ? body : body.slice(0, comma));
            pending = {
                display: comma < 0 ? '' : body.slice(comma + 1).trim(),
                ...(Number.isFinite(seconds) && seconds > 0 ? { durationMs: Math.round(seconds * 1000) } : {}),
            };
            continue;
        }
        if (line.startsWith('#')) continue;

        // A location: the record this entry names is whatever the #EXTINF above it said, or failing
        // that whatever the file is called.
        const entry = splitArtistTitle(pending?.display ?? '') ?? splitArtistTitle(stemOf(line));
        if (entry === undefined) skipped += 1;
        else entries.push({ ...entry, ...(pending?.durationMs === undefined ? {} : { durationMs: pending.durationMs }) });
        pending = undefined;
    }

    return { name: name ?? fallbackName, prompt: '', entries, skipped, notices: skippedNotice(skipped, 'an artist and a title') };
}

const TITLE_HEADERS = ['track name', 'title', 'track', 'song', 'song name', 'track title', 'name'];
const ARTIST_HEADERS = ['artist name(s)', 'artist name', 'artist names', 'artists', 'artist'];
const ALBUM_HEADERS = ['album name', 'album', 'album title'];
const ISRC_HEADERS = ['isrc'];
const DURATION_MS_HEADERS = ['duration (ms)', 'duration_ms', 'duration ms', 'track duration (ms)'];
const DURATION_HEADERS = ['duration', 'length', 'time'];

/**
 * A CSV or TSV with a header row. Columns are found by name, case aside, so an export with forty
 * columns and one with two read the same.
 */
function readCsv(text: string, fallbackName: string): PlaylistImportEntrySource {
    const rows = lines(text).filter(line => line.trim().length > 0);
    const headerLine = rows.shift() ?? '';
    const delimiter = headerLine.includes('\t') ? '\t' : ',';
    const header = splitCsvLine(headerLine, delimiter).map(normalizeHeader);
    const column = (names: readonly string[]) => header.findIndex(cell => names.includes(cell));

    const title = column(TITLE_HEADERS);
    const artist = column(ARTIST_HEADERS);
    const album = column(ALBUM_HEADERS);
    const isrc = column(ISRC_HEADERS);
    const durationMs = column(DURATION_MS_HEADERS);
    const duration = column(DURATION_HEADERS);

    const entries: PlaylistImportEntryInput[] = [];
    let skipped = 0;
    for (const row of joinQuotedRows(rows)) {
        const cells = splitCsvLine(row, delimiter);
        const cell = (at: number) => (at < 0 ? undefined : cells[at]?.trim() || undefined);

        const artists = splitArtists(cell(artist) ?? '');
        const named = cell(title);
        if (named === undefined || artists.length === 0) {
            skipped += 1;
            continue;
        }

        const ms = durationMs >= 0 ? toInteger(cell(durationMs)) : parseClock(cell(duration));
        entries.push({
            title: named,
            artists,
            ...(cell(album) === undefined ? {} : { album: cell(album)! }),
            ...(cell(isrc) === undefined ? {} : { isrc: cell(isrc)!.toUpperCase() }),
            ...(ms === undefined ? {} : { durationMs: ms }),
        });
    }

    const notices = skippedNotice(skipped, 'a title and an artist');
    if (title < 0 || artist < 0) notices.push('this CSV has no column the station recognises as a title or an artist');
    return { name: fallbackName, prompt: '', entries, skipped, notices };
}

/** One `Artist - Title` per line, as a list pasted from anywhere reads. */
function readLines(text: string, fallbackName: string): PlaylistImportEntrySource {
    const entries: PlaylistImportEntryInput[] = [];
    let skipped = 0;
    for (const raw of lines(text)) {
        const line = raw.trim();
        if (line.length === 0 || line.startsWith('#')) continue;

        const entry = splitArtistTitle(line.replace(/^\d{1,4}[.)]\s+/, ''));
        if (entry === undefined) skipped += 1;
        else entries.push(entry);
    }
    return { name: fallbackName, prompt: '', entries, skipped, notices: skippedNotice(skipped, 'the form "Artist - Title"') };
}

/**
 * `Artist - Title` into its halves, on the FIRST separator, since a title carries a dash far more
 * often than a name does ("Song 2 - 2012 Remaster"). A hyphen counts only with a space either side, so
 * "Jay-Z" stays one name; an en or em dash counts with spaces too. Nothing either side is no record.
 */
export function splitArtistTitle(display: string): Pick<PlaylistImportEntryInput, 'title' | 'artists'> | undefined {
    const match = /\s+[-–—]\s+/.exec(display);
    if (match === null) return undefined;

    const artist = display.slice(0, match.index).trim();
    const title = display.slice(match.index + match[0].length).trim();
    if (artist.length === 0 || title.length === 0) return undefined;
    return { title, artists: splitArtists(artist) };
}

/**
 * A credit into its names. A semicolon is taken as the separator when there is one, since some
 * exporters use it to keep a comma inside a name ("Tyler, The Creator"); otherwise a comma is,
 * which is what Exportify writes. Only the lead matters to a match, so the rare name with a comma in
 * a comma-separated credit costs the record's other names rather than the record.
 */
function splitArtists(credit: string): string[] {
    const separator = credit.includes(';') ? ';' : ',';
    return credit
        .split(separator)
        .map(name => name.trim())
        .filter(name => name.length > 0);
}

/**
 * One CSV line's cells, quotes honoured: a quoted cell may carry the delimiter, and `""` inside one
 * is a quote.
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;

    for (let at = 0; at < line.length; at += 1) {
        const char = line[at]!;
        if (quoted) {
            if (char === '"' && line[at + 1] === '"') {
                cell += '"';
                at += 1;
            } else if (char === '"') {
                quoted = false;
            } else {
                cell += char;
            }
        } else if (char === '"') {
            quoted = true;
        } else if (char === delimiter) {
            cells.push(cell);
            cell = '';
        } else {
            cell += char;
        }
    }
    cells.push(cell);
    return cells;
}

/** Rows rejoined where a quoted cell ran over a line break, so one record is one row. */
function joinQuotedRows(rows: readonly string[]): string[] {
    const joined: string[] = [];
    let open: string | undefined;
    for (const row of rows) {
        const current = open === undefined ? row : `${open}\n${row}`;
        if ((current.match(/"/g)?.length ?? 0) % 2 === 1) open = current;
        else {
            joined.push(current);
            open = undefined;
        }
    }
    if (open !== undefined) joined.push(open);
    return joined;
}

function lines(text: string): string[] {
    return text.replace(/^\uFEFF/, '').split(/\r?\n/);
}

function normalizeHeader(cell: string): string {
    return cell.trim().toLowerCase();
}

function toInteger(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** `3:45`, `1:02:03`, or seconds, as milliseconds. */
function parseClock(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parts = value.split(':').map(part => Number.parseFloat(part));
    if (parts.length === 0 || parts.some(part => !Number.isFinite(part) || part < 0)) return undefined;
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    return seconds > 0 ? Math.round(seconds * 1000) : undefined;
}

/** A location's file name without its folder, its extension or a leading track number. */
function stemOf(location: string): string {
    const base = decodeSafely(location.split(/[\\/]/).pop() ?? '');
    return base.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/^\d{1,3}[\s._-]+(?=\S)/, '');
}

function nameFromFile(fileName: string | undefined): string | undefined {
    if (fileName === undefined) return undefined;
    const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
    return stem.length === 0 ? undefined : stem.slice(0, 200);
}

function decodeSafely(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function skippedNotice(skipped: number, shape: string): string[] {
    if (skipped === 0) return [];
    return [`${skipped} ${skipped === 1 ? 'line does' : 'lines do'} not name a record as ${shape}, and will be left out`];
}
