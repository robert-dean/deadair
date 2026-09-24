import type { ReactNode } from 'react';
import { Anchor, Group, Stack, Text, Title } from '@mantine/core';
import { IconChevronLeft } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { StationSettingDescriptor } from '@deadair/sdk';

import { i18n } from '../../i18n/i18n.setup';
import { EmbeddedPage } from '../shared/page.header';
import { usePhone } from '../shared/use.phone';

/**
 * Every section there is.
 *
 * Written as a union rather than derived from the list below, which is the one bit of duplication
 * here and it buys two things worth more than it costs: `SETTINGS_ROUTES` is a `Record` over it, so
 * a section added without a route fails to compile, and `SettingsSection['id']` is narrow enough to
 * index that record — which a list-derived type cannot be while the list is typed by the interface.
 */
export type SettingsSectionId =
    | 'station'
    | 'stream'
    | 'housekeeping'
    | 'mail'
    | 'appearance'
    | 'security'
    | 'rotation'
    | 'breaks'
    | 'bulletins'
    | 'playout'
    | 'render'
    | 'llm'
    | 'analysis'
    | 'artwork'
    | 'storage'
    | 'providers'
    | 'grants'
    | 'plugins';

/**
 * One section of Settings: what it is called, and where its contents come from.
 *
 * The fields split three ways and the split is the mechanism rather than convenience:
 *
 * - A section with a `group` draws that group's declared settings, and its `blurb` is the sentence
 *   under the heading. Most of them. Sign-in and security draws its group too, below cards of its
 *   own about the person signed in, which is `settings.page.tsx`'s business rather than this list's.
 * - A section with neither draws a card of its own that answers to nothing in the registry:
 *   Appearance writes to this browser, Storage is read-only, Grants is somebody else's question.
 * - A section with a `route` is not a card at all. Plugins is its own page.
 */
export interface SettingsSection {
    id: SettingsSectionId;
    label: string;
    /**
     * What the section holds, which is the half a bare label leaves out.
     *
     * "Words" and "Measurement" name subjects rather than settings, so an operator looking for the
     * model has no way to tell which one to open. It was dropped when the sections became a strip of
     * tabs, which had nowhere to put it; the rail and the phone's list both do.
     */
    hint: string;
    /** The declared group this section draws, for the ones that draw one. */
    group?: StationSettingDescriptor['group'];
    /** The sentence under the heading. Only a section with a `group` has one. */
    blurb?: string;
    /** The route this section IS, for the one that is a page rather than a card. */
    route?: '/plugins';
}

/** The sections that open with a sentence under their heading: every one that draws a group, and Providers. */
type BlurbedSectionId = Exclude<SettingsSectionId, 'appearance' | 'artwork' | 'storage' | 'grants' | 'plugins'>;

/**
 * One entry of the list below. Its words are getters that read the catalog each time they are asked
 * for, rather than strings resolved once at import, so a change of language reaches every surface
 * that draws the list (the rail, the phone's index, the command palette) on its next render.
 */
function section(id: SettingsSectionId, more: Pick<SettingsSection, 'group' | 'route'> = {}): SettingsSection {
    return {
        id,
        ...more,
        get label() {
            return i18n.t(`settings:sections.${id}.label`);
        },
        get hint() {
            return i18n.t(`settings:sections.${id}.hint`);
        },
    };
}

/** An entry with a sentence under its heading as well. */
function blurbed(id: BlurbedSectionId, more: Pick<SettingsSection, 'group'> = {}): SettingsSection {
    return {
        id,
        ...more,
        get label() {
            return i18n.t(`settings:sections.${id}.label`);
        },
        get hint() {
            return i18n.t(`settings:sections.${id}.hint`);
        },
        get blurb() {
            return i18n.t(`settings:sections.${id}.blurb`);
        },
    };
}

/**
 * The sections an operator can jump to, in the order they should meet them.
 *
 * **This is the only list.** It was two — the labels here, and a parallel `GROUPS` in
 * `settings.page.tsx` holding the group key and the blurb — so a new section had to be added to
 * both, and a group named in neither was invisible with nothing to catch it. The registry says so
 * in as many words at `settings.registry.ts:145`, and it is right that no test could see it: the
 * page drew what its own list named, so a group nothing named simply never appeared.
 *
 * Not every declared group is here, and the omission is still the mechanism: a group this list does
 * not name is drawn by whichever page claimed it. `schedule` is one — what the station plays
 * between blocks is edited beside the timetable that makes sense of it, by `SustainingPanel`, so
 * naming it here would draw those settings twice. `personas` is the other: the presenter name is
 * edited above the roster whose own names override it, by `PresenterNamePanel`.
 *
 * Plugins is a member rather than a special case appended at the end. It belongs under Settings by
 * subject — a plugin is a thing you configure — and it is why this list lives beside the shell
 * rather than inside the page: it is the one section that is a whole route.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
    blurbed('station', { group: 'station' }),
    // Split out of Station along with Housekeeping: one save under thirty-one fields, from the
    // station's own name to four passwords, was a lot of ground to cover for a visit that usually
    // wants one of them. `SettingGroup` in `settings.types.ck` carries the same split. The
    // passwords had a Secrets page of their own until nothing was left on it: the station seeds
    // them, nothing outside it holds one, and `settings.registry.ts` says why none is declared.
    blurbed('stream', { group: 'stream' }),
    blurbed('housekeeping', { group: 'housekeeping' }),
    // Ahead of Sign-in and security because it is what makes that section's email step work: the
    // codes and sign-in links this station sends go out through whatever is set here, and until
    // something is, they do not go.
    blurbed('mail', { group: 'mail' }),
    // Second, and the only one on this page that changes nothing about the station. It is here
    // because "how do I make this readable in daylight" is a question an operator brings to
    // Settings, and the card itself says plainly that it is remembered on this browser alone.
    section('appearance'),
    // One section with two halves: how YOU sign in, then what the sign-in page offers everybody and
    // who may join through it. They were two sections, Security and "Sign-in and connections", and
    // every feature in them was split across both: a provider is set up on one and linked on the
    // other, apps are allowed and registered on one and approved apps listed on the other, and the
    // page named "connections" was the one that did not show yours. The halves differ in who may
    // change them, which the page says with a heading rather than with a second address.
    blurbed('security', { group: 'signin' }),
    // Rotation was one section holding what the station plays, how often it talks, what goes into a
    // bulletin and every word it says around them: forty-two fields and six boxes of phrasings under
    // one save. Split along `SettingGroup` in `settings.types.ck`, as Station was; the phrasings went
    // to the Voice page, which draws the `phrasings` group, so they are not a section here.
    blurbed('rotation', { group: 'rotation' }),
    blurbed('breaks', { group: 'breaks' }),
    blurbed('bulletins', { group: 'bulletins' }),
    blurbed('playout', { group: 'playout' }),
    blurbed('render', { group: 'render' }),
    blurbed('llm', { group: 'llm' }),
    blurbed('analysis', { group: 'analysis' }),
    section('artwork'),
    section('storage'),
    // Immediately before the two plugin sections, because it is the question they raise: having
    // installed a second thing that can do a job, which one does it. Its settings live in the
    // `providers` group, which no card above draws — the choice is always about the plugins in
    // front of the operator, and a text field holding `deadair.kokoro` is not that.
    blurbed('providers'),
    section('grants'),
    section('plugins', { route: '/plugins' }),
];

/**
 * Where each section goes. Separate from the list above so the labels stay free of route strings.
 *
 * Exported because the command palette navigates to these too, and a second copy of this table is a
 * second place for a section and its route to come apart. The same division `LIBRARY_ROUTES` makes.
 *
 * Heterogeneous on purpose: nine of these are pages under `/settings` and Plugins is not, because it
 * was a route of its own long before the others were. A section is a place; where the place happens
 * to live in the URL is this table's business and nobody else's.
 */
export const SETTINGS_ROUTES: Record<
    SettingsSectionId,
    | '/settings/station'
    | '/settings/stream'
    | '/settings/housekeeping'
    | '/settings/mail'
    | '/settings/appearance'
    | '/settings/security'
    | '/settings/rotation'
    | '/settings/breaks'
    | '/settings/bulletins'
    | '/settings/playout'
    | '/settings/render'
    | '/settings/llm'
    | '/settings/analysis'
    | '/settings/artwork'
    | '/settings/storage'
    | '/settings/providers'
    | '/settings/grants'
    | '/plugins'
> = {
    station: '/settings/station',
    stream: '/settings/stream',
    housekeeping: '/settings/housekeeping',
    mail: '/settings/mail',
    appearance: '/settings/appearance',
    security: '/settings/security',
    rotation: '/settings/rotation',
    breaks: '/settings/breaks',
    bulletins: '/settings/bulletins',
    playout: '/settings/playout',
    render: '/settings/render',
    llm: '/settings/llm',
    analysis: '/settings/analysis',
    artwork: '/settings/artwork',
    storage: '/settings/storage',
    providers: '/settings/providers',
    grants: '/settings/grants',
    plugins: '/plugins',
};

export interface SettingsShellProps {
    /**
     * Which section is being read, or nothing for the list of them.
     *
     * Only a phone reads this, and only to decide whether to draw the way back: on a desk the rail
     * says where the operator is, and it reads that off the router rather than off a prop.
     */
    active?: SettingsSectionId;
    children: ReactNode;
}

/**
 * The station itself, with its sections wherever this viewport keeps them.
 *
 * It has been three navigators. Nine cards in one column with a sticky list of anchors beside them,
 * where an operator who came to change the mount read four sections they did not want on the way.
 * Then a route per section with a strip of tabs, which is the shape every other destination here
 * uses and is the one that does not survive ten of them: 1298px of tabs against a phone's 358 means
 * most of the sections are off-screen while somebody is looking for one, and a strip has nowhere to
 * put the sentence saying what each one holds.
 *
 * Now neither. The rail lists them on a desk and `SettingsIndex` lists them on a phone, so this
 * draws the destination and gets out of the way.
 *
 * **The sections still save one at a time.** The API write is partial, so a section cannot clear
 * another, and the line under the title is where that is said.
 */
export function SettingsShell({ active, children }: SettingsShellProps) {
    const { t } = useTranslation('settings');
    const phone = usePhone();

    // The rail is collapsed on a phone, so a section reached from the list has nothing to get back
    // to it with. On a desk the rail is the way back and a second one would be clutter.
    const back = phone && active !== undefined;

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                {back ? (
                    <Anchor size="sm" underline="never" c="dimmed" w="fit-content" renderRoot={(props: object) => <Link to="/settings" {...props} />}>
                        <Group gap={4} wrap="nowrap">
                            <IconChevronLeft aria-hidden size={14} stroke={2} />
                            {t('shell.allSettings')}
                        </Group>
                    </Anchor>
                ) : undefined}

                <Title order={1}>{t('shell.title')}</Title>
                <Text size="sm" c="dimmed" maw={760}>
                    {t('shell.intro')}
                </Text>
            </Stack>

            {/* Stops each section drawing a second `<h1>` under the destination's own. */}
            <EmbeddedPage>{children}</EmbeddedPage>
        </Stack>
    );
}
