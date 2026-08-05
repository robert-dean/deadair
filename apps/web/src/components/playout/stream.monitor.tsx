import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';

export interface StreamMonitorProps {
    /** Same-origin path of the Icecast mount, from the playout status. */
    mountPath: string;
}

/**
 * Listen to what the station is actually broadcasting, from the console that is
 * driving it.
 *
 * This is a MONITOR, not the product: the stream is the product, and it reaches
 * listeners through Icecast whether or not a browser is open. So this deliberately
 * plays the mount rather than anything local — what you hear here is what a
 * listener hears, including the couple of seconds of encoder and client buffer
 * that puts it behind the console's own reading.
 *
 * Muted until asked. An operator opening the console should not get a blast of
 * audio, browsers block autoplay with sound anyway, and a station that is already
 * on air does not need a second copy of itself playing in the room.
 */
export function StreamMonitor({ mountPath }: StreamMonitorProps) {
    const audio = useRef<HTMLAudioElement>(null);
    const [listening, setListening] = useState(false);
    const [failed, setFailed] = useState(false);

    // Nothing is fetched until the operator asks for it. An <audio> with a live
    // mount as its src holds an open connection for as long as it is mounted, so
    // src is attached on demand and dropped on stop — otherwise every console with
    // a tab open is a listener on the mount, and Icecast counts them.
    useEffect(() => {
        const element = audio.current;
        if (!element) return;

        if (!listening) {
            element.pause();
            element.removeAttribute('src');
            element.load();
            return;
        }

        // Cache-bust so a reconnect starts from the live edge rather than resuming a
        // buffered response the browser held on to.
        element.src = `${mountPath}?t=${Date.now()}`;
        element.play().catch(() => {
            // Autoplay policy, or the mount is down. Either way the button goes back
            // to its resting state rather than claiming to be playing.
            setListening(false);
            setFailed(true);
        });
    }, [listening, mountPath]);

    const label = failed ? 'Could not play the mount' : listening ? 'Stop monitoring' : 'Listen to the stream';

    return (
        <>
            {/* No captions track: this is a live music mount, which has nothing to caption. */}
            <audio ref={audio} preload="none" />
            <Tooltip label={label}>
                <ActionIcon
                    variant={listening ? 'filled' : 'subtle'}
                    color={failed ? 'red' : undefined}
                    aria-label={label}
                    aria-pressed={listening}
                    onClick={() => {
                        setFailed(false);
                        setListening(current => !current);
                    }}
                >
                    {listening ? '🔊' : '🔈'}
                </ActionIcon>
            </Tooltip>
        </>
    );
}
