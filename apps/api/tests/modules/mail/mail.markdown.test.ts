// The renderer an operator's own wording is going to go through, so every test here is one of the
// things that wording could try: markup, a script, a tracking image, a link somewhere it should not
// go, or a placeholder value that is itself markdown.

import { describe, expect, it } from 'vitest';

import { placeholdersIn, renderMailMarkdown } from '../../../src/modules/mail/mail.markdown.js';

describe('rendering mail markdown', () => {
    it('renders paragraphs, emphasis and lists', () => {
        const { html } = renderMailMarkdown('Hello **there**.\n\n- one\n- two', {});

        expect(html).toContain('<p>Hello <strong>there</strong>.</p>');
        expect(html).toContain('<li>one</li>');
    });

    it('prints raw HTML as the characters typed rather than as markup', () => {
        const { html } = renderMailMarkdown('<script>alert(1)</script>\n\nHi <a href="x" onclick="y">there</a>', {});

        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<a href="x"');
        expect(html).toContain('&lt;script&gt;');
    });

    it('draws no images, so nothing in a message is fetched when it is opened', () => {
        const { html } = renderMailMarkdown('![pixel](https://tracker.example/p.gif)', {});

        expect(html).not.toContain('<img');
    });

    it.each(['javascript:alert(1)', 'data:text/html,hi', 'vbscript:x', '/relative', 'ftp://x.test/f'])('refuses a link to %s', href => {
        const { html } = renderMailMarkdown(`[click](${href})`, {});

        expect(html).not.toContain('<a');
    });

    it.each(['https://x.test/a', 'http://x.test/a', 'mailto:a@x.test'])('keeps a link to %s', href => {
        const { html } = renderMailMarkdown(`[click](${href})`, {});

        expect(html).toContain(`<a href="${href}">click</a>`);
    });
});

describe('placeholders', () => {
    it('fills a placeholder in text, in a link and in a link label', () => {
        const { html } = renderMailMarkdown('Welcome to {{station}}. [Join {{station}}]({{link}})', {
            station: 'Dead Air',
            link: 'https://x.test/invite#di_abc',
        });

        expect(html).toBe('<p>Welcome to Dead Air. <a href="https://x.test/invite#di_abc">Join Dead Air</a></p>\n');
    });

    it('escapes a value rather than reading it as markdown or HTML', () => {
        const { html, text } = renderMailMarkdown('This is {{station}}.', { station: '*Dead* <Air> & [co](javascript:x)' });

        expect(html).toBe('<p>This is *Dead* &lt;Air&gt; &amp; [co](javascript:x).</p>\n');
        expect(text).toBe('This is *Dead* <Air> & [co](javascript:x).');
    });

    it('refuses a link placeholder whose value is not a web or mail address', () => {
        expect(() => renderMailMarkdown('[go]({{link}})', { link: 'javascript:alert(1)' })).toThrow(/https, http or mailto/);
    });

    it('throws on a placeholder nothing fills, rather than sending it as typed', () => {
        expect(() => renderMailMarkdown('Open {{link}}', {})).toThrow(/\{\{link\}\}/);
    });

    it('leaves out a paragraph whose placeholder is known and empty, and only that paragraph', () => {
        const { html, text } = renderMailMarkdown('Hello.\n\nGet it [here]({{app}}).\n\nBye.', { app: undefined });

        expect(html).toBe('<p>Hello.</p>\n<p>Bye.</p>\n');
        expect(text).toBe('Hello.\n\nBye.');
    });

    it('leaves out only the list item naming an empty placeholder', () => {
        const { html } = renderMailMarkdown('- [Android]({{android}})\n- [iPhone]({{ios}})', { android: 'https://x.test/a', ios: undefined });

        expect(html).toBe('<ul>\n<li><a href="https://x.test/a">Android</a></li>\n</ul>\n');
    });

    it('leaves out a list whose every item went', () => {
        const { html } = renderMailMarkdown('Before.\n\n- {{a}}\n- {{b}}\n  - {{a}}\n\nAfter.', { a: undefined, b: undefined });

        expect(html).toBe('<p>Before.</p>\n<p>After.</p>\n');
    });

    it('leaves out a nested item without its parent', () => {
        const { text } = renderMailMarkdown('- kept\n  - {{gone}}\n  - also kept', { gone: undefined });

        expect(text).toBe('- kept\n\n  - also kept');
    });

    it('still throws for a placeholder that is not known at all', () => {
        expect(() => renderMailMarkdown('Get it [here]({{app}}).', { other: undefined })).toThrow(/\{\{app\}\}/);
    });

    it('lists the placeholders a source names, once each', () => {
        expect(placeholdersIn('{{a}} and {{b}}, then {{a}} again, and {{ not one }}')).toEqual(['a', 'b']);
    });
});

describe('the plain-text part', () => {
    it('writes a link out with its address, so a client with HTML off can still open it', () => {
        const { text } = renderMailMarkdown('[Make your account]({{link}})', { link: 'https://x.test/invite#t' });

        expect(text).toBe('Make your account (https://x.test/invite#t)');
    });

    it('writes a link whose words are its address only once', () => {
        const { text } = renderMailMarkdown('[https://x.test/a](https://x.test/a)', {});

        expect(text).toBe('https://x.test/a');
    });

    it('keeps blocks apart and lists numbered', () => {
        const { text } = renderMailMarkdown('# Hello\n\nFirst **bold**.\n\n1. one\n2. two\n\n- a\n  - b', {});

        expect(text).toBe('Hello\n\nFirst bold.\n\n1. one\n\n2. two\n\n- a\n\n  - b');
    });
});
