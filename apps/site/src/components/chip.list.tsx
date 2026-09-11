import styles from './chip.list.module.css';

export interface ChipListProps {
    /** A short label over the group, in the page's eyebrow style. */
    label: string;
    title: string;
    note?: string;
    items: readonly string[];
}

/** A group of names: providers, engines, sources. Something to recognise, not something to read. */
export function ChipList({ label, title, note, items }: ChipListProps) {
    return (
        <div className={styles.group}>
            <p className="da-eyebrow">{label}</p>
            <h3 className={styles.title}>{title}</h3>
            {note ? <p className={styles.note}>{note}</p> : undefined}
            <ul className={styles.chips}>
                {items.map(item => (
                    <li key={item}>{item}</li>
                ))}
            </ul>
        </div>
    );
}
