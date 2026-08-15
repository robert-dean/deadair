import { Button, Group, Popover, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useState } from 'react';

import { useReplanOrder } from '../../api/director.queries';
import { apiErrorMessage } from '../../api/sdk.error';

/**
 * Throw out the rest of the hour and have the station programme it again.
 *
 * The third thing an operator can do to programming they do not like, and the copy has to say which
 * of the three it is: Shuffle reorders the same records, going on air with a brief starts a NEW
 * broadcast and stops what is playing, and this changes what is coming while the broadcast carries
 * on. Everything the player is already holding is left alone, which is why nothing here warns about
 * cutting a listener off.
 *
 * **The wait is the design, not slowness.** The whole set is generated before anything is dropped,
 * so the tail the operator is tired of keeps playing until there is a replacement. Emptying the
 * order first would take the station off air within seconds. So the button reports pending and the
 * records appear on the running order's own poll, which is what the help text promises.
 *
 * A popover rather than a bare button because the brief belongs in the same gesture: an operator
 * replanning an hour usually wants different programming, not the same instruction sampled again.
 */
export interface ReplanTheRestProps {
    /** What this broadcast was last asked for, to seed the box. Empty means it was never briefed. */
    brief: string;
    disabled?: boolean;
}

export function ReplanTheRest({ brief, disabled = false }: ReplanTheRestProps) {
    const [open, setOpen] = useState(false);
    // Seeded from the running order, unlike `BriefTheStation`'s empty box, and the difference is
    // real: that one mints a new broadcast where this one edits the instruction this broadcast is
    // already carrying. Showing it is what makes clearing it an obvious thing to do.
    const [asked, setAsked] = useState(brief);
    const replan = useReplanOrder();

    const failure = replan.isError ? apiErrorMessage(replan.error, 'The running order could not be replanned.') : undefined;

    const send = () => {
        const wanted = asked.trim();
        // Sent only when it actually differs. Absent keeps whatever the broadcast is carrying, and
        // an empty string CLEARS it, so passing the box back unchanged would turn "I did not touch
        // this" into a rewrite of the same words.
        replan.mutate(wanted === brief ? {} : { brief: wanted });
        setOpen(false);
    };

    return (
        <Popover opened={open} onChange={setOpen} position="bottom-start" width={380} withArrow shadow="md" trapFocus>
            <Popover.Target>
                <Tooltip
                    label={
                        failure ?? 'Throws out everything the player is not already holding and programmes it again. What is playing is untouched.'
                    }
                    color={failure ? 'red' : undefined}
                    multiline
                    maw={320}
                >
                    <Button
                        variant="light"
                        color={failure ? 'red' : undefined}
                        loading={replan.isPending}
                        disabled={disabled}
                        onClick={() => setOpen(current => !current)}
                    >
                        Replan
                    </Button>
                </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
                <Stack gap="sm">
                    <Text size="sm">
                        Everything still to come is dropped and the station programmes that stretch again. What is playing, and what the player is
                        already holding, keeps going.
                    </Text>
                    <TextInput
                        label="What it should play"
                        placeholder="heavy metal hits"
                        value={asked}
                        maxLength={500}
                        onChange={event => setAsked(event.currentTarget.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') send();
                        }}
                    />
                    <Text size="xs" c="dimmed">
                        This steers every refill for the rest of the broadcast, not just these records. Empty it to hand the programming back to the
                        host.
                    </Text>
                    <Group justify="flex-end">
                        <Button variant="subtle" color="gray" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={send}>Replan</Button>
                    </Group>
                    <Text size="xs" c="dimmed">
                        The records are chosen before the old ones are dropped, so nothing goes quiet. They can take a minute to appear.
                    </Text>
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
}
