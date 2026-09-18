import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import type { ReactNode } from 'react';

import { takedownUrl } from '../community/catalog';
import styles from './community.directory.module.css';

/**
 * One of the community directories: what it lists, how to add to it, and the entries.
 *
 * `entries` is undefined until the catalogue arrives, which is also what the static build renders,
 * so the page ships with its heading and its way in and fills in on load.
 */
export function CommunityDirectory<T>({
    eyebrow,
    title,
    description,
    lede,
    submit,
    notice,
    entries,
    empty,
    children,
}: {
    eyebrow: string;
    title: string;
    /** The page's meta description. */
    description: string;
    lede: ReactNode;
    submit: { label: string; href: string };
    /** Above the entries, for the one thing every visitor has to read first. */
    notice?: ReactNode;
    entries: readonly T[] | undefined;
    empty: ReactNode;
    children: (entry: T) => ReactNode;
}) {
    return (
        <Layout title={title} description={description}>
            <main className={styles.page}>
                <header className={styles.hero}>
                    <p className="da-eyebrow">
                        <Link to="/community">Community</Link> · {eyebrow}
                    </p>
                    <h1 className={styles.headline}>{title}</h1>
                    <div className={styles.lede}>{lede}</div>
                    <div className={styles.actions}>
                        <Link className={styles.primary} href={submit.href}>
                            {submit.label}
                        </Link>
                        {entries !== undefined && entries.length > 0 && <span className={styles.count}>{entries.length} listed</span>}
                    </div>
                </header>

                <section className={styles.section}>
                    {notice !== undefined && <aside className={styles.notice}>{notice}</aside>}
                    {entries === undefined ? (
                        <p className={styles.state} aria-live="polite">
                            Tuning in…
                        </p>
                    ) : entries.length === 0 ? (
                        <div className={styles.state}>{empty}</div>
                    ) : (
                        <div className={styles.grid}>{entries.map(children)}</div>
                    )}
                </section>

                <footer className={styles.section}>
                    <p className={styles.foot}>
                        Everything here is run or written by the person who listed it, not by the deadair project. Something here that should not be,
                        or yours and you want it gone? <Link href={takedownUrl}>Ask for it to come down</Link>; no account needed.
                    </p>
                </footer>
            </main>
        </Layout>
    );
}

/** A labelled row of short values, such as genres or capabilities. */
export function Tags({ items }: { items: readonly string[] }) {
    if (items.length === 0) return null;
    return (
        <ul className={styles.tags}>
            {items.map(item => (
                <li key={item}>{item}</li>
            ))}
        </ul>
    );
}

/** Label and value pairs under an entry's description. */
export function Facts({ facts }: { facts: readonly [label: string, value: ReactNode | undefined][] }) {
    const shown = facts.filter(([, value]) => value !== undefined && value !== '');
    if (shown.length === 0) return null;
    return (
        <dl className={styles.facts}>
            {shown.map(([label, value]) => (
                <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    );
}
