/**
 * The Markdown the station's own release notes are written in, read into a tree the console draws with
 * Mantine.
 *
 * ## A subset, on purpose
 *
 * Exactly what `CHANGELOG.md` uses and nothing more: `#` headings, paragraphs, `-` lists (nested, with
 * wrapped and indented continuation lines), and inline code, bold, italics and links. A full Markdown
 * library would be a dependency the size of the rest of this page to render a file this repository
 * writes itself, and a changelog that one day uses a table gets a paragraph of pipes rather than a
 * broken page.
 *
 * ## Never HTML
 *
 * The tree is drawn as React elements, so nothing here reaches `dangerouslySetInnerHTML`. That matters
 * because the notes for a release the station has not installed yet come from GitHub rather than from
 * the build, and text that arrives over the network is text. A `<link>` inside a code span, which the
 * changelog has, is drawn as the characters it is.
 */

export type Inline =
    | { kind: 'text'; text: string }
    | { kind: 'code'; text: string }
    | { kind: 'strong'; children: Inline[] }
    | { kind: 'em'; children: Inline[] }
    | { kind: 'link'; href: string; children: Inline[] };

export type Block =
    { kind: 'heading'; level: number; children: Inline[] } | { kind: 'paragraph'; children: Inline[] } | { kind: 'list'; items: Block[][] };

/** Where a relative link in the changelog points: the file at that path in the repository. */
const REPOSITORY_BLOB = 'https://github.com/robert-dean/deadair/blob/main/';

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^[-*]\s+(.*)$/;

/** Reads Markdown into blocks. Never throws: anything it does not recognise is a paragraph. */
export function parseMarkdown(text: string): Block[] {
    return parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'));
}

function parseBlocks(lines: string[]): Block[] {
    const blocks: Block[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i]!;

        if (line.trim() === '') {
            i++;
            continue;
        }

        const heading = HEADING.exec(line);
        if (heading !== null) {
            blocks.push({ kind: 'heading', level: heading[1]!.length, children: parseInline(heading[2]!.trim()) });
            i++;
            continue;
        }

        if (LIST_ITEM.test(line)) {
            const items: Block[][] = [];
            while (i < lines.length && LIST_ITEM.test(lines[i]!)) {
                const content = [LIST_ITEM.exec(lines[i]!)![1]!];
                i++;
                // An item runs on through wrapped lines, which the changelog indents and a hand edit
                // might not, and through blank lines for as long as what follows them is indented:
                // that is a second paragraph or a nested list belonging to this item.
                while (i < lines.length) {
                    const next = lines[i]!;
                    if (next.trim() === '') {
                        const after = lines.slice(i + 1).find(candidate => candidate.trim() !== '');
                        if (after === undefined || !/^\s{2,}\S/.test(after)) break;
                        content.push('');
                        i++;
                        continue;
                    }
                    if (/^\s{2,}\S/.test(next)) {
                        content.push(next.replace(/^\s{2}/, ''));
                        i++;
                        continue;
                    }
                    if (LIST_ITEM.test(next) || HEADING.test(next) || content[content.length - 1] === '') break;
                    content.push(next);
                    i++;
                }
                items.push(parseBlocks(content));
            }
            blocks.push({ kind: 'list', items });
            continue;
        }

        const paragraph: string[] = [];
        while (i < lines.length && lines[i]!.trim() !== '' && !HEADING.test(lines[i]!) && !LIST_ITEM.test(lines[i]!)) {
            paragraph.push(lines[i]!.trim());
            i++;
        }
        blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
    }

    return blocks;
}

/**
 * The inline spans, earliest first. A code span is matched before anything else can start inside it,
 * which is what keeps `*laughs*` and `[Jordache](/ʒɔrdæʃ/)` in the changelog as the literal text they
 * are quoting.
 */
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s](?:[^*]*[^*\s])?)\*/;

export function parseInline(text: string): Inline[] {
    const out: Inline[] = [];
    let rest = text;

    while (rest.length > 0) {
        const match = INLINE.exec(rest);
        if (match === null) {
            push(out, rest);
            break;
        }
        push(out, rest.slice(0, match.index));

        const [whole, code, strong, label, href, em] = match;
        if (code !== undefined) {
            out.push({ kind: 'code', text: code });
        } else if (strong !== undefined) {
            out.push({ kind: 'strong', children: parseInline(strong) });
        } else if (label !== undefined && href !== undefined) {
            const safe = safeHref(href);
            if (safe === undefined) {
                out.push(...parseInline(label));
            } else {
                out.push({ kind: 'link', href: safe, children: parseInline(label) });
            }
        } else if (em !== undefined) {
            out.push({ kind: 'em', children: parseInline(em) });
        }
        rest = rest.slice(match.index + whole.length);
    }

    return out;
}

/**
 * Where a link may go: the web, or a file in this repository. Anything else (a `javascript:` URL, a
 * path from the site root that means nothing on a station) keeps its words and loses the link.
 */
export function safeHref(href: string): string | undefined {
    if (/^https?:\/\//i.test(href)) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#') || href.startsWith('.')) return undefined;
    return REPOSITORY_BLOB + href;
}

function push(out: Inline[], text: string) {
    if (text === '') return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') {
        last.text += text;
    } else {
        out.push({ kind: 'text', text });
    }
}
