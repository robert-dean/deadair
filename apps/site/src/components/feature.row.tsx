import type { ReactNode } from 'react';

import styles from './feature.row.module.css';

export interface FeatureRowProps {
    /** "Part three". Read with the kicker as one line: `Part three · The presenter`. */
    part: string;
    kicker: string;
    title: string;
    children: ReactNode;
    /** Usually a `Figure`; two stack. */
    figure: ReactNode;
    /** Which side the words are on. The page alternates them so a long scroll does not read as a list. */
    side?: 'left' | 'right';
}

/** One thing the station does: a few paragraphs on one side, the console showing it on the other. */
export function FeatureRow({ part, kicker, title, children, figure, side = 'left' }: FeatureRowProps) {
    return (
        <section className={`${styles.row} ${side === 'right' ? styles.flipped : ''}`}>
            <div className={styles.words}>
                <p className="da-eyebrow">
                    {part} · {kicker}
                </p>
                <h2 className={styles.title}>{title}</h2>
                <div className={styles.body}>{children}</div>
            </div>
            <div className={styles.figures}>{figure}</div>
        </section>
    );
}
