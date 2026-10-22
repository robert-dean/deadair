/** The address the site is published at. A link in `llms.txt` under it is one this build has to serve. */
export const SITE_ORIGIN = 'https://deadair.radio';

/** `[text](target)`, the only link form llms.txt uses. */
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** Every link target in an llms.txt, in the order written. */
export function llmsLinks(text: string): string[] {
    return [...text.matchAll(LINK)].flatMap(match => (match[1] ? [match[1]] : []));
}

/**
 * The paths among `links` on this site that the build does not serve.
 *
 * `llms.txt` is a static file, so Docusaurus copies it without reading it and its `onBrokenLinks`
 * never sees these: a page renamed under it would leave a model following a dead link with nothing
 * failing. `served` answers for one path, a route or a file in the output, which is the build's
 * business; this only decides which links are ours to ask about. Links elsewhere are not checked.
 */
export function unservedLinks(links: string[], served: (path: string) => boolean): string[] {
    return links
        .filter(link => link === SITE_ORIGIN || link.startsWith(`${SITE_ORIGIN}/`))
        .map(link => new URL(link).pathname)
        .filter(path => !served(path));
}
