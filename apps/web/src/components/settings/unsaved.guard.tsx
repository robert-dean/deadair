import { Button, Group, Modal, Stack, Text } from '@mantine/core';
import { useBlocker } from '@tanstack/react-router';

export interface UnsavedGuardProps {
    /** Whether anything on the page is holding an edit nobody has saved. */
    dirty: boolean;
}

/**
 * Asks before a navigation throws away an edit nobody saved.
 *
 * ## Why this is the first one in the console
 *
 * Every other form here is either a modal, which already confirms on the way out, or a page whose
 * work is one button away from being finished. Settings is neither: a section is its own route,
 * every section saves on its own, and the thing that moves you between them is the same tab strip
 * that moves you anywhere else. Typing a new mount into Station and clicking Rotation used to be
 * scrolling and is now a navigation, so what was impossible to lose is one click from gone.
 *
 * It is deliberately not a general facility. It takes a bit and draws a dialog; what counts as an
 * unsaved edit is `ConfigFieldsForm`'s question, answered there, because clearing a secret is an
 * unsaved change the form's own `isDirty()` cannot see.
 *
 * ## What it covers, and what it cannot
 *
 * `useBlocker` sees router navigations, which is every tab, every nav link, the command palette and
 * the back button. `enableBeforeUnload` hands the other half to the browser: closing the tab or
 * typing a new address gets the browser's own dialog, which cannot be styled or worded and is the
 * only thing available there. Both are gated on the same bit, so neither fires on a saved form.
 *
 * `disabled` rather than a `shouldBlockFn` that returns false: with nothing typed the blocker is not
 * merely permissive, it is not installed, so a clean page cannot pay for this at all.
 */
export function UnsavedGuard({ dirty }: UnsavedGuardProps) {
    const blocker = useBlocker({
        shouldBlockFn: () => dirty,
        enableBeforeUnload: () => dirty,
        disabled: !dirty,
        withResolver: true,
    });

    const blocked = blocker.status === 'blocked';

    return (
        <Modal opened={blocked} onClose={() => blocker.reset?.()} title="You have unsaved changes" centered size="md">
            <Stack gap="md">
                <Text size="sm">
                    Something on this page has been changed and not saved. Leaving now throws it away. Every section saves on its own, so saving here
                    will not touch anything else.
                </Text>

                <Group justify="flex-end" gap="sm">
                    {/* The safe half is the default and sits where a primary action sits, because
                        the destructive half is the one that reads like carrying on. */}
                    <Button variant="default" onClick={() => blocker.proceed?.()}>
                        Discard and leave
                    </Button>
                    <Button onClick={() => blocker.reset?.()}>Stay here</Button>
                </Group>
            </Stack>
        </Modal>
    );
}
