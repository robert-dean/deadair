import { Box, Stack, Text } from '@mantine/core';
import type { ClockBand } from '@deadair/sdk';

export interface FormatClockDialProps {
    bands: readonly ClockBand[];
    /** Kinds nothing installed can currently produce, so a mark can say it will be passed over. */
    unproducible?: ReadonlySet<string>;
}

/** The dial's own geometry, in px. One place, because six values below are derived from it. */
const SIZE = 220;
const RADIUS = SIZE / 2;

/**
 * The format clock, drawn as the instrument it is named after.
 *
 * ## Why a dial earns its place beside the list
 *
 * The list is the editor and stays the editor: a band is a rule with four fields, and you cannot
 * type into a circle. What the list cannot show is the SHAPE of an hour — that the ident at :00,
 * the news at :30 and the weather at :55 leave one long stretch of music and two short ones, or
 * that three rules have piled up inside four minutes. That is a spatial fact, and reading it off
 * rows means doing arithmetic the drawing does for free.
 *
 * ## Only what has a position on an hour
 *
 * An `interval` band is a spacing rule — every twenty minutes, wherever that lands — so it has no
 * fixed place on a dial and is deliberately not drawn. Putting it at an arbitrary angle would be
 * the drawing inventing a precision the rule does not have. The list below carries all of them.
 *
 * A band for one HOUR of the day (`hour` set) is drawn like any other: the dial is one hour of the
 * clock face rather than a particular hour, and where a rule falls inside it is the same answer
 * either way. Whether it fires this time round is the list's business.
 */
export function FormatClockDial({ bands, unproducible }: FormatClockDialProps) {
    const marks = bands.filter(band => band.at === 'clock' && band.enabled).map(band => ({ band, minute: band.minute ?? 0 }));

    return (
        <Stack gap="xs" align="center">
            <Box
                w={SIZE}
                h={SIZE}
                pos="relative"
                role="img"
                aria-label={describe(marks.map(mark => mark.band))}
                style={{
                    borderRadius: '50%',
                    border: '1px solid var(--da-border-strong)',
                    background: 'radial-gradient(circle at 50% 50%, var(--da-raised) 0%, var(--da-panel) 70%)',
                }}
            >
                {/* Quarters, so a mark can be read as "about twenty past" without counting. Drawn
                    under the bands and in the border's own colour: they are a ruler, not content. */}
                {[0, 15, 30, 45].map(minute => (
                    <Tick key={minute} minute={minute} length={7} color="var(--da-border-strong)" />
                ))}

                {marks.map(({ band, minute }) => (
                    <Tick
                        key={band.id}
                        minute={minute}
                        length={18}
                        color={unproducible?.has(band.kind) ? 'var(--mantine-color-yellow-4)' : 'var(--mantine-color-grape-4)'}
                    />
                ))}

                {marks.map(({ band, minute }) => (
                    <Label key={band.id} minute={minute} text={`${band.kind} :${String(minute).padStart(2, '0')}`} />
                ))}

                {/* The hole in the middle. It carries nothing: a live playhead here would be a
                    second clock disagreeing with the one in the header, and the header's is the one
                    an operator already trusts. */}
                <Box
                    pos="absolute"
                    aria-hidden
                    style={{ inset: 62, borderRadius: '50%', border: '1px solid var(--da-border)' }}
                    display="flex"
                >
                    <Stack gap={0} align="center" justify="center" w="100%">
                        <Text size="xs" c="dimmed" ta="center" px="xs">
                            {marks.length === 0 ? 'nothing on the hour' : marks.length === 1 ? '1 break an hour' : `${marks.length} breaks an hour`}
                        </Text>
                    </Stack>
                </Box>
            </Box>
        </Stack>
    );
}

/** One mark on the rim, at the angle a minute sits at. */
function Tick({ minute, length, color }: { minute: number; length: number; color: string }) {
    return (
        <Box
            pos="absolute"
            aria-hidden
            style={{
                left: '50%',
                top: '50%',
                width: 2,
                height: RADIUS - 4,
                transformOrigin: '50% 100%',
                // Minutes run clockwise from the top, which is 0deg in CSS once the element is
                // stood up from the centre.
                transform: `translate(-50%, -100%) rotate(${(minute / 60) * 360}deg)`,
            }}
        >
            <Box w={2} h={length} style={{ background: color, borderRadius: 1 }} />
        </Box>
    );
}

/**
 * A band's name, just inside the rim, at its own angle.
 *
 * `aria-hidden`, like every other part of the dial: the figure carries one label of its own, and
 * the list beside it is the real interface. Without it each band is announced twice and reads as
 * two rules — and `getByText` finds two of everything, which is how this was noticed.
 */
function Label({ minute, text }: { minute: number; text: string }) {
    const angle = ((minute / 60) * 360 - 90) * (Math.PI / 180);
    const distance = RADIUS - 40;

    return (
        <Text
            size="xs"
            c="dimmed"
            aria-hidden
            pos="absolute"
            style={{
                left: RADIUS + Math.cos(angle) * distance,
                top: RADIUS + Math.sin(angle) * distance,
                transform: 'translate(-50%, -50%)',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
            }}
        >
            {text}
        </Text>
    );
}

/**
 * The dial as a sentence, for anybody not looking at it.
 *
 * A circle of absolutely positioned divs is nothing to a screen reader, so the whole figure carries
 * one label and its parts are hidden. The list below is the real interface either way.
 */
function describe(bands: readonly ClockBand[]): string {
    if (bands.length === 0) return 'The format clock has nothing anchored to a time in the hour.';
    const parts = bands.map(band => `${band.kind} at ${String(band.minute ?? 0).padStart(2, '0')} minutes past`);
    return `The format clock: ${parts.join(', ')}.`;
}
