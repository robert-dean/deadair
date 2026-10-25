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
}

/**
 * One thing the station does, as its own ruled band: the title on the left, a few paragraphs on the
 * right, and the console showing it across the full width underneath.
 */
export function FeatureRow({ part, kicker, title, children, figure }: FeatureRowProps) {
    return (
        <section className={styles.row}>
            <div className={styles.inner}>
                <div className={styles.head}>
                    <div>
                        <p className={styles.label}>
                            <span>{part}</span> {kicker}
                        </p>
                        <h2 className={styles.title}>{title}</h2>
                    </div>
                    <div className={styles.body}>{children}</div>
                </div>
                <div className={styles.figures}>{figure}</div>
            </div>
        </section>
    );
}
