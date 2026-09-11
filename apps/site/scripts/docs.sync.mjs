// Some of the site's pages are written once, where the repository's readers already find them, and
// the site reads them from there. Copying them into `docs/` by hand would make the site a second
// place to keep true, and the one nobody remembers. So each build copies them in fresh, with the
// front matter the sidebar needs and an edit link back to the real file, and the copies are
// gitignored.
//
// Most of them are docs, in the sidebar. The Android app's privacy policy is a PAGE, under
// `src/pages`, because it is not documentation: it is the address Google Play and the app itself link
// to, so it wants a short permanent URL (`/privacy/android`) and no sidebar around it. Its source is
// `apps/android/PRIVACY.md`, which stays the one copy, and the app's own repository readers find it there.
//
// A relative link in a source is written for the repository: `src/plugin.error.ts` beside the SDK's
// README is a file on GitHub and not a page on this site, where it would break the build. So every
// relative link outside a code fence is rewritten to that file on GitHub, resolved against the
// source's own directory. A link to an anchor on the same page is left alone.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(site, '../..');
const blob = 'https://github.com/robert-dean/deadair/blob/main';

/** Each source file, and either the doc it becomes and where it sits in the sidebar, or the page it becomes. */
const pages = [
    { source: 'deploy/README.md', doc: 'install.md', label: 'Install', position: 1 },
    { source: 'docs/licensing.md', doc: 'licensing.md', label: 'Music licensing', position: 2 },
    // The plugin contract, which is required reading beside the code and so lives beside the code.
    { source: 'packages/plugin-sdk/README.md', doc: 'plugin-development/contract.md', label: 'The contract', position: 6 },
    // Linked from the Play listing and from the app's settings screen, so its path is a promise.
    { source: 'apps/android/PRIVACY.md', page: 'privacy/android.md', title: 'Privacy policy for deadair for Android' },
];

/** A link target this site cannot serve as written: not absolute, not a scheme, not an anchor. */
const isRelative = target => !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target);

/** `[text](target)` and `![alt](target)`, with an optional title after the target. */
const LINK = /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g;

/** Rewrites every relative link outside a fenced code block to the file on GitHub. */
function rewriteLinks(body, source) {
    const base = posix.dirname(source);
    // Splitting on fences with a capture keeps them, and every odd piece is the inside of one.
    return body
        .split(/(^```[^\n]*\n[\s\S]*?^```[^\n]*$)/m)
        .map((piece, index) =>
            index % 2 === 1
                ? piece
                : piece.replace(LINK, (match, open, target, close) => {
                      if (!isRelative(target)) return match;
                      const [path, anchor] = target.split('#');
                      const resolved = posix.normalize(posix.join(base, path));
                      return `${open}${blob}/${resolved}${anchor === undefined ? '' : `#${anchor}`}${close}`;
                  }),
        )
        .join('');
}

for (const page of pages) {
    const body = rewriteLinks(await readFile(resolve(root, page.source), 'utf8'), page.source);
    // A page has no sidebar and no edit link; it has a title, which a doc takes from its H1.
    const frontMatter = [
        '---',
        ...(page.page
            ? [`title: ${page.title}`]
            : [`sidebar_label: ${page.label}`, `sidebar_position: ${page.position}`, `custom_edit_url: ${blob}/${page.source}`]),
        '---',
        '',
    ].join('\n');
    const notice = `<!-- Copied from ${page.source} by apps/site/scripts/docs.sync.mjs. Edit that file, not this one. -->\n`;

    // After the source's own heading rather than before it: Docusaurus takes a page's title from an
    // H1 only when it is the first thing on the page, and a comment above it left every copied page
    // titled with its file name.
    const heading = /^# [^\n]*\n/.exec(body)?.[0] ?? '';
    const target = page.page ? resolve(site, 'src/pages', page.page) : resolve(site, 'docs', page.doc);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, frontMatter + heading + notice + body.slice(heading.length));
}
