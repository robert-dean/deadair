import type { ReactNode } from 'react';
import { UnstyledButton } from '@mantine/core';

/**
 * The name in a row that opens when it is clicked, as something a keyboard can reach.
 *
 * A clickable `<tr>` cannot take focus, and `tabIndex` and a key handler on it would leave a table row
 * announcing itself as a button and hiding its cells. So the row keeps its `onClick` for the mouse and
 * this is the same action for everybody else: it has no handler of its own, because Enter on a button
 * is a click, and that click bubbles to the row.
 */
export function RowOpener({ children }: { children: ReactNode }) {
    return <UnstyledButton>{children}</UnstyledButton>;
}
