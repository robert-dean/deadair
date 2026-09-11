/**
 * A webp imported from `static/` is its URL, which webpack hashes and copies at build time.
 *
 * Docusaurus's own type aliases declare svg and CSS modules and stop there. Importing an image
 * rather than naming its path is what makes a missing screenshot a failed build instead of a broken
 * picture on the live site.
 */
declare module '*.webp' {
    const src: string;
    export default src;
}
