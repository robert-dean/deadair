/**
 * The little XML a UPnP renderer speaks, read and written by hand.
 *
 * A device description and a SOAP answer are small, flat documents whose every interesting value is
 * the text of one element, and the plugin carries no runtime dependency (see `cast.message.ts` for
 * why). So this reads an element's text by its local name, ignoring any namespace prefix, rather
 * than parsing a tree. It is not a general XML reader and does not try to be: it answers the
 * questions this driver asks of documents shaped the way the UPnP specification shapes them.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Escapes text for an element body or an attribute value. */
export function escapeXml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Undoes {@link escapeXml}, plus numeric character references. */
export function unescapeXml(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
        if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
        if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
        return ENTITIES[entity.toLowerCase()] ?? whole;
    });
}

/** Every element with this local name, as its inner XML, in document order. */
export function elements(xml: string, name: string): string[] {
    const pattern = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'g');
    return [...xml.matchAll(pattern)].map(match => match[1] as string);
}

/** The text of the first element with this local name, unescaped and trimmed, or `undefined`. */
export function text(xml: string, name: string): string | undefined {
    const inner = elements(xml, name)[0];
    return inner === undefined ? undefined : unescapeXml(inner).trim();
}
