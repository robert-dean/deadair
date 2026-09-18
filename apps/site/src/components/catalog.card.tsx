import type { ReactNode } from 'react';

import { formatDate, type Listing } from '../community/catalog';
import styles from './catalog.card.module.css';

/** One entry in a community directory: what it is, who listed it and when, and what to do with it. */
export function CatalogCard({
    eyebrow,
    title,
    subtitle,
    badge,
    listing,
    actions,
    children,
}: {
    eyebrow?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    /** Top right, beside the title: a station's on-air state. */
    badge?: ReactNode;
    listing: Listing;
    actions?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <article className={styles.card}>
            <header className={styles.head}>
                <div>
                    {eyebrow !== undefined && <p className="da-eyebrow">{eyebrow}</p>}
                    <h3 className={styles.title}>{title}</h3>
                    {subtitle !== undefined && <p className={styles.subtitle}>{subtitle}</p>}
                </div>
                {badge}
            </header>
            <div className={styles.body}>{children}</div>
            <footer className={styles.foot}>
                <p className={styles.byline}>
                    by @{listing.submittedBy} · added {formatDate(listing.dateAdded)}
                    {listing.dateModified !== undefined && ` · updated ${formatDate(listing.dateModified)}`}
                </p>
                {actions !== undefined && <div className={styles.actions}>{actions}</div>}
            </footer>
        </article>
    );
}
