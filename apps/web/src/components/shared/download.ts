/**
 * Saving something the API answered with to the operator's disk.
 *
 * Here rather than in the two components that want it, on this console's own rule: `PageHeader`,
 * `ErrorAlert` and `EmptyState` live in this directory because they had been hand-rolled twenty, forty
 * and nine times, and the way that happens is one component at a time. The anchor dance below is
 * eight lines nobody would think to share until it is written twice, which it now is — the plugin log
 * and a persona file.
 *
 * A blob and a synthetic click rather than pointing the browser at the URL, and that is not a
 * preference: every route here is behind a bearer token the SDK holds, and a plain `<a href>` or a
 * `window.open` is a fresh unauthenticated request. The same reason `/voices/{id}/sample` is fetched
 * and played as a blob rather than being put in an `<audio src>`.
 */

/**
 * The filename to save under, out of the response's own `Content-Disposition`.
 *
 * The header comes back `undefined` whenever the response never carried it — a proxy stripped it, or
 * the fetch failed before the server set it — so the fallback is what an operator gets, rather than a
 * download that silently saves as the route's last path segment.
 */
export function downloadFilename(contentDisposition: string | undefined, fallback: string): string {
    const match = contentDisposition ? /filename="?([^";]+)"?/i.exec(contentDisposition) : null;
    return match?.[1] ?? fallback;
}

/**
 * Hand `content` to the browser as a file called `filename`.
 *
 * The object URL is revoked in every case, including the one where the click throws: an object URL
 * that is never revoked pins its blob for the life of the tab, and a console left open for a shift is
 * exactly the tab that would accumulate them.
 */
export function saveDownload(content: BlobPart, filename: string, type: string): void {
    const objectUrl = URL.createObjectURL(new Blob([content], { type }));

    try {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

/** {@link saveDownload} for a document the API answered as JSON, indented so the file is readable. */
export function saveJsonDownload(document: unknown, filename: string): void {
    saveDownload(JSON.stringify(document, undefined, 4), filename, 'application/json');
}
