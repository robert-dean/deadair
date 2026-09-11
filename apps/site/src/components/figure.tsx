import { useRef } from 'react';

import { SHOT_HEIGHT, SHOT_WIDTH, shots, type ShotId } from './console.figures';
import styles from './figure.module.css';

export interface FigureProps {
    shot: ShotId;
    /** Counted by the page rather than here, so a section moved up the page keeps an honest number. */
    number?: number;
    caption: string;
    /**
     * The shape of the window onto the screenshot, as width over height, when less than all of it is
     * worth showing. The whole picture is still what opens when it is clicked.
     */
    aspect?: number;
    /** Which part of the screenshot the window shows, as `object-position` takes it. */
    focus?: string;
    /** For a figure the reader will see first, which should not wait to be scrolled to. */
    eager?: boolean;
}

/**
 * A screenshot in a frame, with a caption, that opens at full size.
 *
 * The console is drawn at a desk's width and a figure beside a paragraph is about half that, so the
 * text in it is small. Clicking opens the full picture in a native dialog: Escape closes it, focus
 * returns to the figure, and there is no library for either.
 */
export function Figure({ shot, number, caption, aspect, focus, eager }: FigureProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const { src, alt } = shots[shot];
    const label = number === undefined ? caption : `Fig. ${String(number).padStart(2, '0')}  ${caption}`;

    return (
        <figure className={styles.figure}>
            <button type="button" className={styles.frame} onClick={() => dialog.current?.showModal()} aria-label={`${caption}. Open at full size.`}>
                <img
                    src={src}
                    alt={alt}
                    width={SHOT_WIDTH}
                    height={SHOT_HEIGHT}
                    loading={eager ? 'eager' : 'lazy'}
                    decoding="async"
                    style={aspect ? { aspectRatio: String(aspect), objectPosition: focus ?? 'left top' } : undefined}
                />
            </button>
            <figcaption className={styles.caption}>{label}</figcaption>
            <dialog ref={dialog} className={styles.dialog} onClick={() => dialog.current?.close()} aria-label={caption}>
                <img src={src} alt={alt} width={SHOT_WIDTH} height={SHOT_HEIGHT} loading="lazy" decoding="async" />
            </dialog>
        </figure>
    );
}
