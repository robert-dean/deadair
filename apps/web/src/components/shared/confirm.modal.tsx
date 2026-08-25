import type { ReactNode } from 'react';
import { Button, Group, Modal, Stack, Text } from '@mantine/core';

import { ErrorAlert } from './error.alert';

export interface ConfirmModalProps {
    opened: boolean;
    onClose: () => void;
    onConfirm: () => void;
    /** The question, as a question. */
    title: string;
    /** What goes, what stays, and what it costs. One or two sentences. */
    children: ReactNode;
    /** The word on the button that does it, which should be the verb rather than "OK". */
    confirmLabel: string;
    /** While the mutation behind the button is in flight. */
    confirming?: boolean;
    /** Reported inside the dialog, because the dialog is where the operator still is. */
    error?: unknown;
    /** What to say when the mutation failed, and what was left alone. */
    errorTitle?: string;
    errorFallback?: string;
}

/**
 * Asking before something that cannot be taken back.
 *
 * There were three idioms for this. Two proper Mantine dialogs written a fortnight apart, and two
 * `window.confirm` calls, which is the browser's own chrome landing in the middle of a console with
 * its own palette, its own type and its own idea of where a destructive button goes. The native one
 * also loses the thing that makes the dialogs here worth having: it can carry a sentence and it
 * cannot carry a pending state or an error, so a delete that failed reported nothing at all.
 *
 * Deliberately declarative rather than an imperative `modals.openConfirmModal`. The console's
 * existing dialogs are components with props and the state that drives them is already a `useState`
 * on the page; an imperative manager would be a second way to open a dialog rather than one way.
 *
 * `confirmLabel` is a required verb because "OK" answers a question nobody asked: an operator
 * reading fast sees the button before the sentence, and Delete against Cancel is the whole dialog.
 */
export function ConfirmModal({
    opened,
    onClose,
    onConfirm,
    title,
    children,
    confirmLabel,
    confirming = false,
    error,
    errorTitle = 'That could not be done',
    errorFallback = 'Nothing was changed.',
}: ConfirmModalProps) {
    return (
        <Modal opened={opened} onClose={onClose} title={title} centered>
            <Stack gap="md">
                {typeof children === 'string' ? <Text size="sm">{children}</Text> : children}

                {error ? <ErrorAlert title={errorTitle} error={error} fallback={errorFallback} /> : undefined}

                <Group justify="flex-end">
                    <Button variant="default" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button color="red" loading={confirming} onClick={onConfirm}>
                        {confirmLabel}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
