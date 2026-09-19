import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import { codeOfConduct, contributing, venues } from '../../community/venues';
import styles from './community.module.css';

/** The catalogue's directories, each a page under /community. */
const directories = [
    {
        label: 'Stations',
        body: 'Stations other people run, whether each is on the air right now, and what it is playing.',
        to: '/community/stations',
        cta: 'Tune in',
    },
    {
        label: 'Personas',
        body: 'Presenters and callers other operators wrote, each a file the console imports as it stands.',
        to: '/community/personas',
        cta: 'Meet them',
    },
    {
        label: 'Plugins',
        body: 'Music sources, facts, voices and models written outside the project. Listed by their authors, and not reviewed by anybody.',
        to: '/community/plugins',
        cta: 'Browse them',
    },
    {
        label: 'Apps',
        body: 'Players, remotes, integrations and libraries, by the project and by other people.',
        to: '/community/apps',
        cta: 'Take your pick',
    },
];

export default function Community() {
    return (
        <Layout title="Community" description="Where the people running deadair stations talk, and how to share what you built.">
            <main className={styles.page}>
                <header className={styles.hero}>
                    <p className="da-eyebrow">Community</p>
                    <h1 className={styles.headline}>Everybody here runs a station.</h1>
                    <p className={styles.lede}>
                        Each one is somebody’s own: their music, their presenter, their clock. This is where they compare notes, help each other get
                        on the air, and hand over the parts worth keeping.
                    </p>
                </header>

                <section className={styles.section}>
                    <h2>Share.</h2>
                    <p className={styles.sectionLede}>
                        What other people run and made, listed by them. Add yours through a form; a maintainer reads each one before it goes up.
                    </p>
                    <div className={styles.cards}>
                        {directories.map(directory => (
                            <div key={directory.to} className={styles.card}>
                                <p className="da-eyebrow">{directory.label}</p>
                                <p>{directory.body}</p>
                                <Link to={directory.to}>{directory.cta}</Link>
                            </div>
                        ))}
                    </div>
                </section>

                <section className={styles.section}>
                    <h2>Talk.</h2>
                    <p className={styles.sectionLede}>All of it happens on the project’s GitHub Discussions, so there is one place to search.</p>
                    <div className={styles.cards}>
                        {venues.map(venue => (
                            <div key={venue.label} className={styles.card}>
                                <p className="da-eyebrow">{venue.label}</p>
                                <p>{venue.body}</p>
                                <Link href={venue.href}>{venue.cta}</Link>
                            </div>
                        ))}
                    </div>
                </section>

                <section className={styles.section}>
                    <h2>Build.</h2>
                    <div className={styles.cards}>
                        <div className={styles.card}>
                            <p className="da-eyebrow">A plugin</p>
                            <p>
                                A music source, a place facts come from, a voice or a model. The SDK is on npm and the guide walks through a real
                                plugin built outside this repository.
                            </p>
                            <Link to="/docs/plugin-development">Writing plugins</Link>
                        </div>
                        <div className={styles.card}>
                            <p className="da-eyebrow">A client</p>
                            <p>
                                A player, a bot, a panel on a wall. Everything the console does goes through the same HTTP API, and an API key lets
                                your code do it too.
                            </p>
                            <Link to="/docs/api-reference">The API reference</Link>
                        </div>
                        <div className={styles.card}>
                            <p className="da-eyebrow">The station itself</p>
                            <p>
                                Pull requests are welcome, and an issue first is welcome for anything large. The rules that bounce a change are short.
                            </p>
                            <Link href={contributing}>Contributing</Link>
                        </div>
                    </div>
                </section>

                <section className={styles.section}>
                    <p className={styles.note}>
                        Be decent to each other. <Link href={codeOfConduct}>The code of conduct</Link> is short and applies everywhere the project is.
                    </p>
                </section>
            </main>
        </Layout>
    );
}
