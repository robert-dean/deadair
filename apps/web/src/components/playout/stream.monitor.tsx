import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Group, Popover, Slider, Stack, Text, Tooltip } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';

export interface StreamMonitorProps {
    /** Same-origin path of the Icecast mount, from the playout status. */
    mountPath: string;
}

/** Where the monitor's own level is remembered. Per browser: it is a listening preference, not a station setting. */
const VOLUME_KEY = 'deadair.monitor.volume';

/** How often the monitor measures how far behind its own playback has fallen. */
const MEASURE_MS = 1_000;

/**
 * How much unplayed audio the element may sit on before the monitor starts
 * catching up, and how fast it catches up.
 *
 * A media element plays a live stream at 1× from wherever it connected, so
 * whatever it buffered on connect — or accumulated riding out a hiccup — is a
 * delay it keeps forever. Playing 3% fast drains that at about two seconds a
 * minute, which is inaudible with `preservesPitch` on, where a seek would cost a
 * reconnect (an Icecast mount has no seekable range).
 *
 * The threshold is not zero on purpose: trimming down to nothing leaves no slack
 * at all, and the next hiccup is then a dropout.
 */
const TRIM_ABOVE_S = 1.2;
const TRIM_RATE = 1.03;

/**
 * Listen to what the station is actually broadcasting, from the console that is
 * driving it.
 *
 * This is a MONITOR, not the product: the stream is the product, and it reaches
 * listeners through Icecast whether or not a browser is open. So this deliberately
 * plays the mount rather than anything local — what you hear here is what a
 * listener hears.
 *
 * It does, however, refuse to fall further behind than it has to. The delay has
 * two parts: the encoder and Icecast on one side, which the console cannot see or
 * change, and the browser's own buffer on the other, which it can — see
 * {@link TRIM_ABOVE_S}. The measured part is reported rather than hidden, because
 * an operator pressing skip and counting the seconds deserves a number instead of
 * a suspicion.
 *
 * Muted until asked. An operator opening the console should not get a blast of
 * audio, browsers block autoplay with sound anyway, and a station that is already
 * on air does not need a second copy of itself playing in the room. The level is
 * this browser's alone: nothing here reaches the mount, so a monitor turned to
 * zero is silence in one room and a station still on air everywhere else.
 */
export function StreamMonitor({ mountPath }: StreamMonitorProps) {
    const audio = useRef<HTMLAudioElement>(null);
    const [listening, setListening] = useState(false);
    const [failed, setFailed] = useState(false);
    const [behindS, setBehindS] = useState<number | undefined>(undefined);
    const [volume, setVolume] = useLocalStorage({ key: VOLUME_KEY, defaultValue: 80 });

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

    // The level applies to the element whether or not it is playing, so turning it
    // down before pressing listen does what it looks like it does.
    useEffect(() => {
        if (audio.current) audio.current.volume = volume / 100;
    }, [volume, listening]);

    // Measure the buffer, and spend it. Only while listening: with no src there is
    // nothing to measure, and an interval left running would be a timer per console.
    useEffect(() => {
        if (!listening) return;

        const timer = setInterval(() => {
            const element = audio.current;
            if (!element || element.buffered.length === 0) return;

            const behind = element.buffered.end(element.buffered.length - 1) - element.currentTime;
            setBehindS(behind);
            element.preservesPitch = true;
            element.playbackRate = behind > TRIM_ABOVE_S ? TRIM_RATE : 1;
        }, MEASURE_MS);
        return () => {
            clearInterval(timer);
        };
    }, [listening]);

    const label = failed ? 'Could not play the mount' : listening ? 'Stop monitoring' : 'Listen to the stream';
    const lag = behindS === undefined ? undefined : `about ${behindS.toFixed(1)}s behind the audio it has received`;

    return (
        <Group gap={4} wrap="nowrap">
            {/* No captions track: this is a live music mount, which has nothing to caption. */}
            <audio ref={audio} preload="none" />
            <Tooltip label={lag && listening ? `${label} (${lag})` : label}>
                <ActionIcon
                    variant={listening ? 'filled' : 'subtle'}
                    color={failed ? 'red' : undefined}
                    aria-label={label}
                    aria-pressed={listening}
                    onClick={() => {
                        setFailed(false);
                        // Whichever way this goes, the last measurement is about a
                        // connection that is ending or has not been made.
                        setBehindS(undefined);
                        setListening(current => !current);
                    }}
                >
                    {listening ? '🔊' : '🔈'}
                </ActionIcon>
            </Tooltip>

            <Popover position="bottom-end" withArrow shadow="md">
                <Popover.Target>
                    <ActionIcon variant="subtle" aria-label="Monitor volume">
                        ⋮
                    </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown>
                    <Stack gap="xs" w={180}>
                        <Text size="xs" c="dimmed">
                            Monitor volume, for this console only. Nothing here reaches the mount.
                        </Text>
                        <Slider
                            value={volume}
                            onChange={setVolume}
                            min={0}
                            max={100}
                            label={value => `${value}%`}
                            aria-label="Monitor volume level"
                        />
                        {listening && lag ? (
                            <Text size="xs" c="dimmed">
                                Playing {lag}. The encoder and Icecast add more that the browser cannot measure.
                            </Text>
                        ) : undefined}
                    </Stack>
                </Popover.Dropdown>
            </Popover>
        </Group>
    );
}
