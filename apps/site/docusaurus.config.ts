import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const repository = 'https://github.com/robert-dean/deadair';

const config: Config = {
    title: 'deadair',
    tagline: 'An AI radio station you run yourself.',
    favicon: 'favicon.png',

    url: 'https://deadair.radio',
    baseUrl: '/',
    // GitHub Pages serves `install.html` at `/docs/install` without a redirect, and a trailing slash
    // would give every page two addresses.
    trailingSlash: false,

    future: { v4: true },

    onBrokenLinks: 'throw',
    markdown: {
        // `.md` is CommonMark and `.mdx` is MDX. The operator docs copied in by `docs.sync.mjs` are
        // plain Markdown written for GitHub, and parsing them as MDX would reject any `<` or `{` in
        // prose that GitHub renders happily.
        format: 'detect',
        hooks: { onBrokenMarkdownLinks: 'throw' },
    },

    // The brand mark lives with the console and is served from there rather than copied. Everything
    // in `apps/web/public` is therefore on the site too, which today is the logo and the favicon.
    staticDirectories: ['../web/public'],

    clientModules: ['./src/fonts.ts'],

    presets: [
        [
            'classic',
            {
                docs: {
                    editUrl: `${repository}/tree/main/apps/site/`,
                },
                blog: false,
                theme: { customCss: './src/css/custom.css' },
            } satisfies Preset.Options,
        ],
    ],

    themeConfig: {
        // The console is dark-first and so is this. One scheme means one set of colours to get right.
        colorMode: { defaultMode: 'dark', disableSwitch: true, respectPrefersColorScheme: false },
        image: 'logo.png',
        navbar: {
            title: 'deadair',
            logo: { alt: 'deadair', src: 'logo-mark.png' },
            items: [
                { type: 'doc', docId: 'install', label: 'Install', position: 'left' },
                { type: 'doc', docId: 'licensing', label: 'Licensing', position: 'left' },
                { href: repository, label: 'GitHub', position: 'right' },
            ],
        },
        footer: {
            style: 'dark',
            links: [
                {
                    title: 'Run it',
                    items: [
                        { label: 'Install', to: '/docs/install' },
                        { label: 'Music licensing', to: '/docs/licensing' },
                    ],
                },
                {
                    title: 'Project',
                    items: [
                        { label: 'Source', href: repository },
                        { label: 'Issues', href: `${repository}/issues` },
                        { label: 'Changelog', href: `${repository}/blob/main/CHANGELOG.md` },
                    ],
                },
            ],
            copyright: 'deadair is MIT licensed. The music is yours, and so are the rights to it.',
        },
        prism: {
            theme: prismThemes.oneDark,
            darkTheme: prismThemes.oneDark,
            additionalLanguages: ['bash', 'sql'],
        },
    } satisfies Preset.ThemeConfig,
};

export default config;
