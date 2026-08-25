import { describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { ConfirmModal } from '../../../src/components/shared/confirm.modal';
import { render, screen, setupUser } from '../../utils/render';

describe('ConfirmModal', () => {
    it('asks the question and names the verb, so the button answers it without reading the sentence', () => {
        render(
            <ConfirmModal opened onClose={vi.fn()} onConfirm={vi.fn()} title="Delete sport?" confirmLabel="Delete">
                Two bands on the format clock ask for it and will go too.
            </ConfirmModal>,
        );

        expect(screen.getByText('Delete sport?')).toBeInTheDocument();
        expect(screen.getByText(/Two bands on the format clock/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('confirms through the callback rather than closing itself, so the caller owns what happens next', async () => {
        const onConfirm = vi.fn();
        const onClose = vi.fn();
        const user = setupUser();
        render(
            <ConfirmModal opened onClose={onClose} onConfirm={onConfirm} title="Delete sport?" confirmLabel="Delete">
                Nothing else changes.
            </ConfirmModal>,
        );

        await user.click(screen.getByRole('button', { name: 'Delete' }));

        expect(onConfirm).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });

    /**
     * The whole reason this is not `window.confirm`: the native one takes the answer and vanishes,
     * so a delete that failed reported nothing at all.
     */
    it('reports a failure inside the dialog, where the operator still is', () => {
        const error = new SdkError(409, 'Conflict', { statusCode: 409, message: 'A band still asks for it' }, new Headers());
        render(
            <ConfirmModal
                opened
                onClose={vi.fn()}
                onConfirm={vi.fn()}
                title="Delete sport?"
                confirmLabel="Delete"
                error={error}
                errorTitle="That subject could not be deleted"
                errorFallback="Nothing was removed."
            >
                Nothing else changes.
            </ConfirmModal>,
        );

        expect(screen.getByText('That subject could not be deleted')).toBeInTheDocument();
        expect(screen.getByText(/A band still asks for it/)).toBeInTheDocument();
    });

    it('draws nothing while it is closed', () => {
        render(
            <ConfirmModal opened={false} onClose={vi.fn()} onConfirm={vi.fn()} title="Delete sport?" confirmLabel="Delete">
                Nothing else changes.
            </ConfirmModal>,
        );

        expect(screen.queryByText('Delete sport?')).not.toBeInTheDocument();
    });
});
