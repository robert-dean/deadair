import type { ReactNode } from 'react';
import { Stack, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { DestinationTabs, type DestinationTab } from '../shared/destination.tabs';
import { EmbeddedPage } from '../shared/page.header';
import { i18n } from '../../i18n/i18n.setup';

/**
 * The tabs, and the sentence behind each.
 *
 * `label` and `hint` are getters rather than strings, so the shell's rail and the palette, which read
 * this table directly, get the words in the language on screen at the moment they read them rather
 * than whatever was on screen when this module was imported.
 */
export const CHECKUP_TABS = [
    tab('machinery'),
    tab('history'),
    tab('cost'),
    tab('logs'),
    tab('releases'),
] as const satisfies readonly DestinationTab<string>[];

function tab<TKey extends 'machinery' | 'history' | 'cost' | 'logs' | 'releases'>(key: TKey) {
    return {
        key,
        get label(): string {
            return i18n.t(`station:shell.tabs.${key}.label`);
        },
        get hint(): string {
            return i18n.t(`station:shell.tabs.${key}.hint`);
        },
    };
}

export type CheckupTab = (typeof CHECKUP_TABS)[number]['key'];

/** Where each tab goes, so the palette and the tab strip cannot disagree about it. */
export const CHECKUP_ROUTES: Record<CheckupTab, '/checkup' | '/activity' | '/traces' | '/logs' | '/releases'> = {
    machinery: '/checkup',
    history: '/activity',
    cost: '/traces',
    logs: '/logs',
    releases: '/releases',
};

export interface CheckupShellProps {
    active: CheckupTab;
    children: ReactNode;
}

/**
 * The machinery, what the station has been doing, what that cost, and the raw record underneath.
 *
 * The first three are one question asked in three tenses. Check-up says what the machinery is doing
 * NOW — five loops turning, six of nine plugins up — the activity feed says what it DID, and the
 * traces say what each decision spent doing it. An operator who finds a stalled loop on the first
 * page immediately wants the second, and one who finds a warning there wants the third.
 *
 * Logs is not a fourth tense. The other three are the station's own account of itself, composed and
 * worded; this is what the processes actually wrote, including the two that are not the station at
 * all. It is where somebody ends up when the composed answer was not enough, which is why it is last
 * rather than first.
 *
 * What's new is about the build rather than about what it is doing: which release this is, and what
 * changed in it. It sits here because Check-up is where the build is already named, and last because
 * it is the tab an operator opens after an upgrade rather than when something is wrong.
 *
 * Separate routes rather than a search param, unlike Voice: each carries its own filters and its own
 * scroll or drawer state, and there is nothing to gain by moving that into a sibling's query string.
 * The tab strip navigates between them.
 */
export function CheckupShell({ active, children }: CheckupShellProps) {
    const { t } = useTranslation('station');
    const navigate = useNavigate();

    return (
        <Stack gap="lg">
            {/* Name only: each tab opens with its own description, and the rail says what every
                section is. This one used to carry the Machinery tab's opening line almost word for
                word, drawn directly above it. See `library.shell.tsx`. */}
            <Title order={1}>{t('shell.title')}</Title>

            <DestinationTabs
                tabs={CHECKUP_TABS}
                active={active}
                label={t('shell.title')}
                onSelect={key => {
                    void navigate({ to: CHECKUP_ROUTES[key] });
                }}
            />

            <EmbeddedPage>{children}</EmbeddedPage>
        </Stack>
    );
}
