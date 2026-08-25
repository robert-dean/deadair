import { Badge, Box, Group, Text } from '@mantine/core';

import { type StatusTone, toneColor } from './status';

export interface StatusLampProps {
    tone: StatusTone;
    label: string;
    /**
     * `lamp` is a dot and a word, for a state sitting quietly on a busy card. `chip` is a filled
     * badge, for the one state on a page that an operator should see from across the room.
     */
    emphasis?: 'lamp' | 'chip';
    size?: 'sm' | 'md';
    /** Only ever true for something genuinely live. See `tokens.css`. */
    pulse?: boolean;
}

/**
 * One thing's state, drawn.
 *
 * The console had two idioms for this and both were right on their own page: plugins used a quiet
 * dot because a card is busy, the station used a filled badge because the tally light is the most
 * important object on the screen. Neither was wrong, so neither was deleted — they are the two
 * values of `emphasis`, over one tone vocabulary, which is what stops a third surface inventing a
 * third answer.
 */
export function StatusLamp({ tone, label, emphasis = 'lamp', size = 'sm', pulse = false }: StatusLampProps) {
    const color = toneColor[tone];

    if (emphasis === 'chip') {
        return (
            <Badge variant="filled" color={color} className={pulse ? 'da-lamp-pulse' : undefined}>
                {label}
            </Badge>
        );
    }

    const dot = size === 'md' ? 10 : 8;
    return (
        <Group gap="xxs" wrap="nowrap" aria-label={`Status: ${label}`}>
            <Box w={dot} h={dot} bg={`${color}.5`} className={pulse ? 'da-lamp-pulse' : undefined} style={{ borderRadius: '50%', flexShrink: 0 }} />
            <Text size={size === 'md' ? 'sm' : 'xs'} fw={600} tt="uppercase" style={{ letterSpacing: 'var(--da-tracking-eyebrow)' }}>
                {label}
            </Text>
        </Group>
    );
}
