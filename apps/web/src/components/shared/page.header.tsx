import { createContext, useContext, type ReactNode } from 'react';
import { Box, Group, Stack, Title, VisuallyHidden } from '@mantine/core';

import { Eyebrow } from './eyebrow';
import { usePhone } from './use.phone';

/**
 * Whether this page is being drawn INSIDE a destination that already named it.
 *
 * A context rather than a prop, and that is the whole point of it. When nineteen nav links became
 * four destinations, twelve pages became tab bodies — and every one of them opens with a
 * `PageHeader` carrying an `<h1>`. Threading a flag through twelve components would have meant
 * editing twelve files to say something none of them can know: whether they are the page or a tab
 * on one. The destination knows, so the destination says it, once.
 */
const EmbeddedContext = createContext(false);

/** Wraps a tab body so the `PageHeader` inside it stops drawing a second page title. */
export function EmbeddedPage({ children }: { children: ReactNode }) {
    return <EmbeddedContext.Provider value>{children}</EmbeddedContext.Provider>;
}

export interface PageHeaderProps {
    title: ReactNode;
    /** The small mono legend above the title, naming what KIND of page this is. */
    eyebrow?: string;
    /** One line under the title. Kept short: it is orientation, not documentation. */
    description?: ReactNode;
    /** Buttons for this page, held on the title's own line. */
    actions?: ReactNode;
    /** Anything that belongs immediately under the description, such as a row of status badges. */
    children?: ReactNode;
}

/**
 * The top of a page: what this is, and what can be done to it.
 *
 * Twenty pages each built this out of a `Stack` and a `Title`, which is how the console ended up
 * with actions above the heading on some pages and beside it on others. Here the actions are
 * always on the title's line and always to the right, because on a desk the label and its control
 * belong together.
 */
export function PageHeader({ title, eyebrow, description, actions, children }: PageHeaderProps) {
    const embedded = useContext(EmbeddedContext);
    // On a phone the actions drop under the title and wrap among themselves instead of being
    // pinned beside it: pinning is what stops a long title crushing them on a desk, and it is
    // also exactly what pushed a three-button row off the right edge of a 375px page.
    const phone = usePhone();

    // As a tab body, the destination's own heading and the selected tab already say what this is,
    // and repeating it is both a second `<h1>` in the document and a line of dead width above every
    // tab. The title stays in the accessibility tree rather than being deleted: it is what a screen
    // reader reads to say which tab it landed in.
    if (embedded) {
        return (
            <Stack gap="xxs">
                <VisuallyHidden>
                    <Title order={2}>{title}</Title>
                </VisuallyHidden>
                {/*
                    Wraps on every viewport, not only on a phone: a description long enough to matter
                    (Voice > Characters, eight lines) was squeezed into a ~220px ribbon beside the
                    actions on a 1200px desk rather than being given the row. The description gets a
                    measure and a flex basis so it takes the full row once the actions do not fit
                    beside it; a short description with a couple of buttons still fits on one line.
                */}
                <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
                    {description ? (
                        <Box maw={720} style={{ flex: '1 1 320px' }}>
                            {description}
                        </Box>
                    ) : (
                        <span />
                    )}
                    {actions ? (
                        <Group gap="xs" wrap={phone ? 'wrap' : 'nowrap'} style={{ flexShrink: 0 }}>
                            {actions}
                        </Group>
                    ) : undefined}
                </Group>
                {children}
            </Stack>
        );
    }

    return (
        <Stack gap="xxs">
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : undefined}
            <Group justify="space-between" align="flex-start" wrap={phone ? 'wrap' : 'nowrap'} gap="md">
                <Title order={1}>{title}</Title>
                {actions ? (
                    // Pinned for the same reason as the embedded branch above: a long title must
                    // truncate before it starts crushing the page's own controls.
                    <Group gap="xs" wrap={phone ? 'wrap' : 'nowrap'} style={phone ? undefined : { flexShrink: 0 }}>
                        {actions}
                    </Group>
                ) : undefined}
            </Group>
            {description}
            {children}
        </Stack>
    );
}
