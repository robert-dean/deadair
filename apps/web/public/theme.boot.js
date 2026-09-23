/*
 * The stored theme, applied before the first paint.
 *
 * Blocking on purpose: `src/theme.store.ts` writes this same attribute, but it cannot run until the
 * module graph has loaded, and every frame before that is a frame of carbon on a console somebody
 * set to paper. The rules in `index.html` are keyed on the attribute this sets, so the background
 * and the scheme land together.
 *
 * A file rather than an inline `<script>`, because the edge's Content-Security-Policy says
 * `script-src 'self'` (nginx/snippets/console.headers.conf) and an inline script is exactly what
 * that refuses. A hash of it in the policy would have worked too, and would have broken the day
 * anybody edited this comment. It lives in `public/` so Vite copies it through untouched: a
 * classic script is not something it bundles, and this has to run before any module does.
 *
 * The two names are duplicated from `themes.ts` because no module has loaded yet. Anything
 * unrecognised falls through to carbon, which is what the markup already says.
 */
try {
    var stored = window.localStorage.getItem('da-theme');
    if (stored === 'white' || stored === 'neon') {
        document.documentElement.setAttribute('data-da-theme', stored);
        document.documentElement.setAttribute('data-mantine-color-scheme', stored === 'white' ? 'light' : 'dark');
    }
} catch (error) {
    /* Site data is blocked. Carbon it is. */
}
