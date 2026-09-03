// The hook is the plumbing behind three toggle buttons that used to draw with no `aria-expanded`
// and no `aria-controls`, so what is worth testing here is only what the hook itself promises: the
// pair stays in step with `open`, and the id stays the SAME id across renders — a fresh one every
// time would leave `aria-controls` pointing nowhere the panel could match.

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDisclosureIds } from '../../../src/components/shared/disclosure';

describe('useDisclosureIds', () => {
    it('says the trigger is not expanded and points aria-controls at the panel id', () => {
        const { result } = renderHook(() => useDisclosureIds(false));

        expect(result.current.trigger['aria-expanded']).toBe(false);
        expect(result.current.trigger['aria-controls']).toBe(result.current.panelId);
    });

    it('flips aria-expanded when the caller says open, without changing the id', () => {
        const { result, rerender } = renderHook(({ open }) => useDisclosureIds(open), { initialProps: { open: false } });
        const firstId = result.current.panelId;

        rerender({ open: true });

        expect(result.current.trigger['aria-expanded']).toBe(true);
        expect(result.current.trigger['aria-controls']).toBe(firstId);
        expect(result.current.panelId).toBe(firstId);
    });
});
