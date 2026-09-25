import type { MouseEvent } from 'react';

/**
 * Saves a catalogue file rather than opening it.
 *
 * A link's `download` attribute is ignored for a file on another origin, and the catalogue is on
 * one, so a plain link would show the JSON in the tab. This fetches it and saves the bytes instead,
 * and falls back to that plain link when the fetch fails. The href stays the file's own address, so
 * copying the link or opening it in a new tab still works.
 */
export function DownloadLink({ href, filename }: { href: string; filename: string }) {
    const save = async (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        try {
            const response = await fetch(href);
            if (!response.ok) throw new Error(String(response.status));
            const url = URL.createObjectURL(await response.blob());
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch {
            window.location.href = href;
        }
    };
    return (
        <a href={href} onClick={event => void save(event)}>
            Download
        </a>
    );
}
