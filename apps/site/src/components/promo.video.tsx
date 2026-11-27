import useBaseUrl from '@docusaurus/useBaseUrl';

import styles from './promo.video.module.css';

export interface PromoVideoProps {
    caption: string;
}

/**
 * The promo, played from this site rather than embedded from a video host, so the page loads
 * nothing from anybody else and the film ends on the station's own card rather than on a wall of
 * other people's videos.
 *
 * It has a voice, so it never autoplays, and `preload="none"` means a reader who never presses play
 * downloads the poster and nothing else. The captions are written from the same schedule the
 * voiceover was mixed to, one cue per line with who says it.
 */
export function PromoVideo({ caption }: PromoVideoProps) {
    return (
        <figure className={styles.figure}>
            <div className={styles.frame}>
                <video
                    className={styles.video}
                    controls
                    preload="none"
                    playsInline
                    poster={useBaseUrl('/video/promo.poster.webp')}
                    width={1920}
                    height={1080}
                    aria-label={caption}
                >
                    <source src={useBaseUrl('/video/promo.mp4')} type="video/mp4" />
                    <track kind="captions" src={useBaseUrl('/video/promo.en.vtt')} srcLang="en" label="English" />
                </video>
            </div>
            <figcaption className={styles.caption}>{caption}</figcaption>
        </figure>
    );
}
