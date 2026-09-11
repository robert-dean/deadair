import type { ShotId } from './console.figures';
import styles from './console.tour.module.css';
import { Figure } from './figure';

export interface TourStop {
    shot: ShotId;
    title: string;
    body: string;
}

export interface ConsoleTourProps {
    stops: readonly TourStop[];
}

/** The rest of the console, a numbered panel each: a picture, a name and a sentence. */
export function ConsoleTour({ stops }: ConsoleTourProps) {
    return (
        <ol className={styles.tour}>
            {stops.map((stop, index) => (
                <li key={stop.shot} className={styles.stop}>
                    <Figure shot={stop.shot} caption={stop.title} />
                    <div className={styles.words}>
                        <span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                            <h3>{stop.title}</h3>
                            <p>{stop.body}</p>
                        </div>
                    </div>
                </li>
            ))}
        </ol>
    );
}
