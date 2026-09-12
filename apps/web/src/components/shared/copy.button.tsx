import { useEffect, useRef, useState } from 'react';
import { Button, Popover, Stack, Text, TextInput } from '@mantine/core';

import { copyText } from './clipboard';
import { severityColor, toneColor } from './status';

export interface CopyButtonProps {
    /**
     * The exact text that lands on the clipboard.
     *
     * Not always the text on screen beside the button: the check-up shows a revision as seven
     * characters and copies all forty, and shows a mount as its path and copies the full address.
     */
    value: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

/** How long "Copied" stays up. Mantine's `CopyButton` default, which is what every one of these used. */
const COPIED_MS = 1000;

/**
 * The console's one Copy button, for a command, an address or a key an operator is meant to take
 * somewhere else.
 *
 * It replaced Mantine's `CopyButton` in five places, each with the same render prop hand-rolled
 * around it, and it is not that component with a new name. Mantine's copies only through
 * `navigator.clipboard`, which a station opened over plain HTTP on its own network does not have, and
 * it fails without a word. This one goes through {@link copyText}, which falls back to the older
 * selection copy, and when BOTH refuse it says so rather than sitting at "Copy".
 *
 * ## What failing looks like
 *
 * The button reads "Copy failed" and a popover opens under it holding the whole value in a field
 * that is already focused and selected, so the keyboard shortcut finishes the job. The popover rather
 * than advice to select the text beside the button, because two callers do not show the whole value
 * (see {@link CopyButtonProps.value}), and "select it yourself" is false about text that is not on
 * screen. It stays open until dismissed, where "Copied" clears itself: a failure is something the
 * operator still has to act on, and the whole defect being fixed here is a copy that failed out of
 * sight.
 *
 * The failure is drawn as a `warning` rather than a `failure`, on that vocabulary's own terms: the
 * thing that failed while everything around it kept working.
 */
export function CopyButton({ value }: CopyButtonProps) {
    const [state, setState] = useState<CopyState>('idle');
    const timer = useRef<number | undefined>(undefined);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    const copy = async () => {
        window.clearTimeout(timer.current);
        if (await copyText(value)) {
            setState('copied');
            timer.current = window.setTimeout(() => setState('idle'), COPIED_MS);
        } else {
            setState('failed');
        }
    };

    const color = state === 'copied' ? toneColor.ok : state === 'failed' ? severityColor.warning : undefined;

    return (
        <Popover
            opened={state === 'failed'}
            onChange={opened => {
                if (!opened) setState('idle');
            }}
            position="bottom-end"
            width={320}
            withArrow
            shadow="md"
            trapFocus
            returnFocus
        >
            <Popover.Target>
                <Button size="compact-xs" variant="subtle" color={color} onClick={() => void copy()}>
                    {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
                </Button>
            </Popover.Target>
            <Popover.Dropdown>
                <Stack gap="xs">
                    <Text size="xs">This browser would not copy it. It is selected below, so copy it with your keyboard instead.</Text>
                    <TextInput
                        size="xs"
                        aria-label="Text to copy"
                        readOnly
                        value={value}
                        data-autofocus
                        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                        onFocus={event => event.currentTarget.select()}
                    />
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
}
