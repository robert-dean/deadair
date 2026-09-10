// The operator docs are written once, where the repository's readers already find them, and the
// site reads them from there. Copying them into `docs/` by hand would make the site a second place
// to keep true, and the one nobody remembers. So each build copies them in fresh, with the front
// matter the sidebar needs and an edit link back to the real file, and the copies are gitignored.
//
// Neither source carries a relative link, which is what makes a plain copy safe: a link to
// `unraid/deadair.xml` would resolve in the repository and break the site's build. Add one to
// either file and this script has to learn to rewrite it.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(site, '../..');

/** Each source file, the doc it becomes, and where it sits in the sidebar. */
const pages = [
    { source: 'deploy/README.md', doc: 'install.md', label: 'Install', position: 1 },
    { source: 'docs/licensing.md', doc: 'licensing.md', label: 'Music licensing', position: 2 },
];

for (const page of pages) {
    const body = await readFile(resolve(root, page.source), 'utf8');
    const frontMatter = [
        '---',
        `sidebar_label: ${page.label}`,
        `sidebar_position: ${page.position}`,
        `custom_edit_url: https://github.com/robert-dean/deadair/blob/main/${page.source}`,
        '---',
        '',
        `<!-- Copied from ${page.source} by apps/site/scripts/docs.sync.mjs. Edit that file, not this one. -->`,
        '',
    ].join('\n');

    const target = resolve(site, 'docs', page.doc);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, frontMatter + body);
}
