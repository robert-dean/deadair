// The dialog every authored file comes in through. What is pinned: something that is not a document never
// reaches the station, the preview's reading is what is shown, and Import sends what was previewed.

import { describe, expect, it, vi } from 'vitest';
import type { PackImportPlan } from '@deadair/sdk';

import { PackImportModal, packFieldsIn } from '../../../src/components/shared/pack.import.modal';
import { fireEvent } from '@testing-library/react';
import { render, screen, setupUser, waitFor } from '../../utils/render';

interface File1 {
    format: string;
    rows: unknown[];
}

const plan: PackImportPlan = {
    name: 'A file',
    adding: ['One', 'Two'],
    skipped: ['Three'],
    dropped: [{ entry: 4, words: 'Four', reason: 'it has no key' }],
    notices: [{ kind: 'unknown-kind', message: 'This station has no traffic breaks.' }],
};

function mutation<TAnswer>(answer: TAnswer) {
    const mutate = vi.fn((_file: File1, options?: { onSuccess?: (value: TAnswer) => void }) => options?.onSuccess?.(answer));
    return { mutate, reset: vi.fn(), isPending: false, isError: false, error: undefined };
}

function open(preview = mutation(plan), write = mutation({})) {
    const onClose = vi.fn();
    const view = render(
        <PackImportModal<File1, object>
            opened
            onClose={onClose}
            title="Import rows"
            intro="Add rows."
            addingLine={count => `Adds ${count} rows:`}
            read={text => packFieldsIn<File1>(text, ['format', 'rows'])}
            preview={preview}
            write={write}
        />,
    );
    return { preview, write, onClose, view };
}

const choose = (text: string) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([text], 'rows.json', { type: 'application/json' })] } });
};

describe('packFieldsIn', () => {
    it('keeps the named fields and leaves out the rest', () => {
        expect(packFieldsIn<File1>('{"format":"a","rows":[],"extra":1}', ['format', 'rows'])).toEqual({ format: 'a', rows: [] });
    });

    it.each(['not json', '[1,2]', 'null', '3'])('answers nothing for %s', text => {
        expect(packFieldsIn<File1>(text, ['format'])).toBeUndefined();
    });
});

describe('PackImportModal', () => {
    it('does not ask the station about something that is not a document', async () => {
        const { preview } = open();
        choose('not json');
        await screen.findByText(/rows\.json/);
        expect(preview.mutate).not.toHaveBeenCalled();
    });

    it('shows what the station said', async () => {
        open();
        choose('{"format":"a","rows":[]}');
        expect(await screen.findByText('Adds 2 rows:')).toBeInTheDocument();
        expect(screen.getByText('One')).toBeInTheDocument();
        expect(screen.getByText(/it has no key/)).toBeInTheDocument();
        expect(screen.getByText('This station has no traffic breaks.')).toBeInTheDocument();
    });

    it('sends what was previewed, then closes', async () => {
        const user = setupUser();
        const { write, onClose } = open();
        choose('{"format":"a","rows":[],"extra":1}');
        await screen.findByText('Adds 2 rows:');
        await user.click(screen.getByRole('button', { name: /add them/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(write.mutate.mock.calls[0]?.[0]).toEqual({ format: 'a', rows: [] });
    });

    it('offers nothing to add when the file adds nothing', async () => {
        open(mutation({ ...plan, adding: [] }));
        choose('{"format":"a","rows":[]}');
        await screen.findByText(/nothing in this file/i);
        expect(screen.getByRole('button', { name: /add them/i })).toBeDisabled();
    });
});
