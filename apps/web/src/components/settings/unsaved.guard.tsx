import { useBlocker } from '@tanstack/react-router';

import { ConfirmModal } from '../shared/confirm.modal';

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
 * It is deliberately not a general facility. It takes a bit and asks a question; what counts as an
 * unsaved edit is `ConfigFieldsForm`'s question, answered there, because clearing a secret is an
 * unsaved change the form's own `isDirty()` cannot see.
 *
 * ## The dialog is the console's own, and the destructive half is the one that leaves
 *
 * `ConfirmModal` rather than a `Modal` written here, on its own argument: there were three idioms
 * for asking this before it existed, and a fourth would be the same drift again. Its shape fits
 * without bending — Cancel is `reset` and stays put, and the red verb is `proceed`.
 *
 * That puts the emphasis on discarding, which is worth being deliberate about: the operator did not
 * ask to discard anything, they asked to go somewhere. The red is what says the second thing is
 * about to happen because of the first, and Cancel is the way out that every other dialog here
 * already spells the same way.
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

    return (
        <ConfirmModal
            opened={blocker.status === 'blocked'}
            // Dismissing is staying put, never discarding. Escape and the close button are reflexes,
            // and resolving them the other way would throw the work away on the most casual gesture
            // there is. `ConfirmModal` wires both to `onClose`, which is the half that keeps it.
            onClose={() => blocker.reset?.()}
            onConfirm={() => blocker.proceed?.()}
            title="Discard unsaved changes?"
            confirmLabel="Discard changes"
        >
            Something on this page has been changed and not saved. Leaving now throws it away. Every section saves on its own, so saving here will not
            touch anything else.
        </ConfirmModal>
    );
}
