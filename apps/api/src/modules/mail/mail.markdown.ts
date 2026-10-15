import MarkdownIt, { type Token } from 'markdown-it';

/**
 * Markdown for a message body, rendered to both of the parts a message carries.
 *
 * Locked down for a reason that outlives the one template written in it today: a body is going to
 * be text an operator types into a settings page, and what it renders to is HTML sent to an inbox
 * under the station's name. So raw HTML is off (a `<script>` or an `<a onclick>` arrives as the
 * characters typed), images are off (the station sends nothing a mail client fetches, which is how
 * a read receipt is built), and a link goes nowhere but `https:`, `http:` or `mailto:`.
 *
 * `{{name}}` is a placeholder, filled in AFTER the markdown is parsed rather than pasted into the
 * source before it. Pasting first is the obvious version and it is wrong: a station called
 * `*Dead* <Air>` would change the formatting of every message it sent, and a value is only safe if
 * the renderer's own escaping is the last thing to touch it.
 */
export interface RenderedMarkdown {
    html: string;
    /** The same message for a client with HTML off: no markup, and every link written out in full. */
    text: string;
}

/** What a placeholder may be called. Letters only, so `{{` can never start anything else markdown reads. */
const PLACEHOLDER = /\{\{([a-zA-Z]+)\}\}/g;
const PLACEHOLDER_ONLY = /^\{\{[a-zA-Z]+\}\}$/;
const ALLOWED_LINK = /^(https?:|mailto:)/i;

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.disable('image');

const normalizeLink = md.normalizeLink.bind(md);
// A link written as `({{link}})` has to survive parsing whole, or it reaches the substitution below
// percent-encoded as `%7B%7Blink%7D%7D`. Anything else is normalised exactly as markdown-it would.
md.normalizeLink = url => (PLACEHOLDER_ONLY.test(url) ? url : normalizeLink(url));
md.validateLink = url => PLACEHOLDER_ONLY.test(url) || ALLOWED_LINK.test(url);

/** Every placeholder named in `source`, once each, in the order they first appear. */
export function placeholdersIn(source: string): string[] {
    return [...new Set([...source.matchAll(PLACEHOLDER)].map(match => match[1]!))];
}

/**
 * Render `source` with its placeholders filled from `values`.
 *
 * A placeholder with no value throws: the built-in templates are checked by their tests, and a
 * message with `{{link}}` left in it is the one that cannot be acted on, by the one person who then
 * has no way to say so.
 */
export function renderMailMarkdown(source: string, values: Readonly<Record<string, string>>): RenderedMarkdown {
    const tokens = md.parse(source, {});
    for (const token of tokens) fill(token, values);
    return { html: md.renderer.render(tokens, md.options, {}), text: toText(tokens) };
}

function fill(token: Token, values: Readonly<Record<string, string>>): void {
    if (token.type === 'text' || token.type === 'code_inline' || token.type === 'code_block' || token.type === 'fence') {
        token.content = substitute(token.content, values);
    }
    if (token.type === 'link_open') {
        const href = token.attrGet('href');
        if (typeof href === 'string' && PLACEHOLDER_ONLY.test(href)) {
            const url = substitute(href, values);
            if (!ALLOWED_LINK.test(url)) throw new Error(`a link in a message must be https, http or mailto, and ${href} is not`);
            token.attrSet('href', normalizeLink(url));
        }
    }
    for (const child of token.children ?? []) fill(child, values);
}

function substitute(content: string, values: Readonly<Record<string, string>>): string {
    return content.replace(PLACEHOLDER, (whole, name: string) => {
        const value = values[name];
        if (value === undefined) throw new Error(`the message names ${whole}, and nothing fills it`);
        return value;
    });
}

/**
 * The plain part, written from the same tokens as the HTML so the two cannot say different things.
 *
 * Blocks are separated by a blank line, a list item keeps its bullet or its number, and a link is
 * its words followed by its address, since an address nobody can see is a link nobody can open.
 */
function toText(tokens: Token[]): string {
    const blocks: string[] = [];
    const lists: { ordered: boolean; next: number }[] = [];
    let prefix = '';

    for (const token of tokens) {
        switch (token.type) {
            case 'bullet_list_open':
            case 'ordered_list_open':
                lists.push({ ordered: token.type === 'ordered_list_open', next: Number(token.attrGet('start') ?? 1) });
                break;
            case 'bullet_list_close':
            case 'ordered_list_close':
                lists.pop();
                break;
            case 'list_item_open': {
                const list = lists.at(-1)!;
                prefix = `${'  '.repeat(lists.length - 1)}${list.ordered ? `${list.next++}.` : '-'} `;
                break;
            }
            case 'inline':
                blocks.push(prefix + inlineText(token.children ?? []));
                prefix = '';
                break;
            case 'code_block':
            case 'fence':
                blocks.push(token.content.replace(/\n$/, ''));
                break;
            case 'hr':
                blocks.push('---');
                break;
        }
    }
    return blocks.join('\n\n');
}

function inlineText(children: Token[]): string {
    let out = '';
    let link: { href: string; start: number } | undefined;
    for (const child of children) {
        switch (child.type) {
            case 'text':
            case 'code_inline':
                out += child.content;
                break;
            case 'softbreak':
            case 'hardbreak':
                out += '\n';
                break;
            case 'link_open':
                link = { href: String(child.attrGet('href') ?? ''), start: out.length };
                break;
            case 'link_close':
                if (link && out.slice(link.start) !== link.href) out += ` (${link.href})`;
                link = undefined;
                break;
        }
    }
    return out;
}
