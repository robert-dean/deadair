import { createFileRoute, stripSearchParams } from '@tanstack/react-router';

import { DEFAULT_PROGRAMME_TAB, isProgrammeTab, type ProgrammeTab } from '../../components/schedule/schedule.page';
import { ShowEditorPage } from '../../components/schedule/show.editor.page';

export interface ShowSearch {
    /** The Programme tab the operator came from, which Back and a save return to. */
    from: ProgrammeTab;
}

const DEFAULTS: ShowSearch = { from: DEFAULT_PROGRAMME_TAB };

/** One show of the schedule, by its id. See `ShowEditorPage` for why it is a page. */
export const Route = createFileRoute('/schedule/show/$slotId')({
    component: ShowRoute,
    validateSearch: (input: Record<string, unknown>): ShowSearch => ({ from: isProgrammeTab(input.from) ? input.from : DEFAULT_PROGRAMME_TAB }),
    search: { middlewares: [stripSearchParams(DEFAULTS)] },
});

function ShowRoute() {
    const { slotId } = Route.useParams();
    const { from } = Route.useSearch();

    // Keyed on the id, so moving from one show to another builds a fresh form: `useForm` reads its
    // initial values once per mount.
    return <ShowEditorPage key={slotId} open={{ slotId }} from={from} />;
}
