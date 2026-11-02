// A row that opens on a click has to open from the keyboard too. What is pinned is that the opener
// reaches the row's own handler, which is why it needs none of its own.

import { describe, expect, it, vi } from 'vitest';
import { Table } from '@mantine/core';

import { RowOpener } from '../../../src/components/shared/row.opener';
import { render, screen, setupUser } from '../../utils/render';

describe('RowOpener', () => {
    it('opens the row from the keyboard', async () => {
        const onOpen = vi.fn();
        const user = setupUser();
        render(
            <Table>
                <Table.Tbody>
                    <Table.Tr onClick={onOpen}>
                        <Table.Td>
                            <RowOpener>Top of the hour</RowOpener>
                        </Table.Td>
                    </Table.Tr>
                </Table.Tbody>
            </Table>,
        );

        await user.tab();
        expect(screen.getByRole('button', { name: 'Top of the hour' })).toHaveFocus();
        await user.keyboard('{Enter}');

        expect(onOpen).toHaveBeenCalledOnce();
    });
});
