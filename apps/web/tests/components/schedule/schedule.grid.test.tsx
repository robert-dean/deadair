// A block ending at midnight is handed to the grid exactly as the API sends it, ending at the next
// day's 00:00. Before 9.7, `@mantine/schedule` filtered an event by the hour and minute of its end
// without its date, read that 00:00 as ending before the column begins and dropped the block from
// both views, so the console rewrote the end to 23:59:59 on its own day — and that one-second
// shortfall then followed every drag, landing the block on `hh:mm:59`. The other way round, a lower
// edge resized to the bottom of the column comes back as 23:59, never midnight, which `resizedEnd`
// reads for what it is. These draw, drag and resize the real components, so an upgrade of the
// package that changes any of those rules shows up here rather than on somebody's station.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DayView, WeekView } from '@mantine/schedule';
import { createEvent, fireEvent } from '@testing-library/react';

import { render, screen } from '../../utils/render';

const LATE = { id: 'late', title: 'LateNite', color: 'blue', start: '2026-08-19 22:00:00', end: '2026-08-20 00:00:00' };

/**
 * jsdom lays nothing out, so the day is drawn one pixel per minute: each time slot at the time in its
 * label, and everything else (the column a resize measures against among it) as the whole day.
 */
function layOutSlotsByTime(): () => void {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const time = / (\d\d):(\d\d):\d\d - /.exec(this.getAttribute('aria-label') ?? '');
        if (time === null) return { top: 0, bottom: 1440, left: 0, right: 100, height: 1440, width: 100, x: 0, y: 0, toJSON: () => ({}) };
        const top = Number(time[1]) * 60 + Number(time[2]);
        return { top, bottom: top + 59, left: 0, right: 100, height: 60, width: 100, x: 0, y: top, toJSON: () => ({}) };
    };
    return () => {
        Element.prototype.getBoundingClientRect = original;
    };
}

/** Drags the block onto the time slot named by `slotLabel`, as a pointer at minute `clientY` of the day. */
function dragOnto(slotLabel: RegExp, clientY: number): void {
    const data: Record<string, string> = {};
    const dataTransfer = {
        get types() {
            return Object.keys(data);
        },
        setData: (format: string, value: string) => (data[format] = value),
        getData: (format: string) => data[format] ?? '',
    };
    fireEvent.dragStart(screen.getByText('LateNite').closest('[data-event-id]')!, { dataTransfer });

    const slot = screen.getAllByLabelText(slotLabel)[0]!;
    // jsdom's drag events carry no coordinates of their own, and the grid finds the slot by them.
    for (const make of [createEvent.dragOver, createEvent.drop]) {
        const event = make(slot, { dataTransfer });
        Object.defineProperty(event, 'clientY', { value: clientY });
        fireEvent(slot, event);
    }
}

/** Drags the block's lower edge to minute `clientY` of the day. */
function resizeLowerEdgeTo(title: string, clientY: number): void {
    const handles = screen.getByText(title).closest('[data-event-id]')!.querySelectorAll('[class*="ResizeHandle"]');
    fireEvent.pointerDown(handles[handles.length - 1]!, { clientY: 0 });
    fireEvent.pointerMove(document, { clientY });
    fireEvent.pointerUp(document, { clientY });
}

describe('the timetable grid', () => {
    it('draws a block ending at the next midnight in the day view', () => {
        render(<DayView date="2026-08-19" events={[LATE]} />);

        expect(screen.getByText('LateNite')).toBeInTheDocument();
    });

    it('draws a block ending at the next midnight in the week view', () => {
        render(<WeekView date="2026-08-19" events={[LATE]} />);

        expect(screen.getByText('LateNite')).toBeInTheDocument();
    });

    describe('dragging a block that ends at midnight', () => {
        let restore: () => void;
        beforeEach(() => {
            restore = layOutSlotsByTime();
        });
        afterEach(() => restore());

        it('drops it in the day view keeping its length to the second', () => {
            const onEventDrop = vi.fn();
            render(<DayView date="2026-08-19" intervalMinutes={60} events={[LATE]} withEventsDragAndDrop onEventDrop={onEventDrop} />);

            dragOnto(/ 21:00:00 - /, 21 * 60);

            expect(onEventDrop).toHaveBeenCalledWith(expect.objectContaining({ newStart: '2026-08-19 21:00:00', newEnd: '2026-08-19 23:00:00' }));
        });

        it('drops it in the week view keeping its length to the second', () => {
            const onEventDrop = vi.fn();
            render(<WeekView date="2026-08-19" intervalMinutes={60} events={[LATE]} withEventsDragAndDrop onEventDrop={onEventDrop} />);

            dragOnto(/ 2026-08-19 21:00:00 - /, 21 * 60);

            expect(onEventDrop).toHaveBeenCalledWith(expect.objectContaining({ newStart: '2026-08-19 21:00:00', newEnd: '2026-08-19 23:00:00' }));
        });
    });

    describe('resizing a block to the bottom of the column', () => {
        // With the page's own settings, which are the package's defaults: the column ends at
        // 23:59:59, in 15-minute slots by the day and hour-long ones by the week.
        const EVENING = { id: 'evening', title: 'Evening', color: 'blue', start: '2026-08-19 20:00:00', end: '2026-08-19 22:00:00' };

        let restore: () => void;
        beforeEach(() => {
            restore = layOutSlotsByTime();
        });
        afterEach(() => restore());

        it('ends it at 23:59 in the day view, not at midnight', () => {
            const onEventResize = vi.fn();
            render(<DayView date="2026-08-19" events={[EVENING]} withEventResize onEventResize={onEventResize} />);

            resizeLowerEdgeTo('Evening', 24 * 60);

            expect(onEventResize).toHaveBeenCalledWith(expect.objectContaining({ newStart: EVENING.start, newEnd: '2026-08-19 23:59:00' }));
        });

        it('ends it at 23:59 in the week view, not at midnight', () => {
            const onEventResize = vi.fn();
            render(<WeekView date="2026-08-19" events={[EVENING]} withEventResize onEventResize={onEventResize} />);

            resizeLowerEdgeTo('Evening', 24 * 60);

            expect(onEventResize).toHaveBeenCalledWith(expect.objectContaining({ newStart: EVENING.start, newEnd: '2026-08-19 23:59:00' }));
        });
    });
});
