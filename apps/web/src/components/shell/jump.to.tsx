import { useState } from 'react';
import { useDebouncedValue } from '@mantine/hooks';
import { Spotlight, type SpotlightActionGroupData } from '@mantine/spotlight';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { catalogArtistsOptions, catalogTracksOptions } from '../../api/catalog.queries';
import { usePersonas } from '../../api/personas.queries';
import { CATALOG_ALBUM_DEFAULTS } from '../catalog/catalog.page.params';
import { LIBRARY_ROUTES, LIBRARY_TABS } from '../library/library.shell';
import { PROGRAMME_TABS } from '../schedule/schedule.page';
import { SETTINGS_ROUTES, SETTINGS_SECTIONS } from '../settings/settings.shell';
import { CHECKUP_ROUTES, CHECKUP_TABS } from '../station/checkup.shell';
import { VOICE_TABS } from '../voice/voice.page';

/** Below this many characters, a search asks nothing: a single letter matches most of the library. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 6;

/**
 * Every place the console has, behind one box — and, once somebody actually types, the records and
 * characters it holds too.
 *
 * ## Why this exists at all
 *
 * Nineteen nav links became four destinations, which is the right shape for arriving and the wrong
 * one for going somewhere specific. An operator who wants the pronunciations table now has to know
 * it is a tab on Voice; one who wants the mount has to know it is the Station section of Settings.
 * The tabs are the answer to "what else is here", and this is the answer to "I already know what I
 * want".
 *
 * ## The pages are known at build time; the records and characters are not
 *
 * This used to say "no track search, no plugin list, no recent anything" and mean it: every action
 * was in the table before the box ever opened. That held for a console with four destinations, and
 * stopped holding the moment somebody typed a record's name into it and got told there was no page
 * by that name — a station's whole reason for existing is the records, and the one console it runs
 * on could not find one. So the page groups stay instant and complete on open, and TWO more groups
 * — Records and Characters — populate once the query is long enough to be worth a request, behind
 * the same debounce a search box anywhere else in this console uses. A cold Records group before
 * that point is not a bug: it is the palette being honest that it has not asked yet.
 *
 * ## The lists are the destinations' own
 *
 * `VOICE_TABS`, `LIBRARY_TABS`, `PROGRAMME_TABS`, `CHECKUP_TABS` and `SETTINGS_SECTIONS` are the
 * tables their own tab strips and rail sections are drawn from, imported rather than restated. A tab
 * added to Voice is in the palette without anybody remembering this file, which is the only version
 * of this that stays true.
 */
export function JumpTo() {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [debounced] = useDebouncedValue(query, DEBOUNCE_MS);
    const searching = debounced.trim().length >= MIN_QUERY;

    // Personas carry no search parameter at all — `usePersonas` is always the whole roster, cached
    // for a while by its own query — so this narrows what is already in memory rather than issuing a
    // request the API has nowhere to put a filter on.
    const personas = usePersonas();

    const tracks = useQuery({
        ...catalogTracksOptions({ page: 0, search: debounced, pageSize: RESULT_LIMIT }),
        enabled: searching,
    });
    const artists = useQuery({
        ...catalogArtistsOptions({ page: 0, search: debounced, pageSize: RESULT_LIMIT }),
        enabled: searching,
    });

    const pageGroups: SpotlightActionGroupData[] = [
        {
            group: 'Destinations',
            actions: [
                {
                    id: 'desk',
                    label: 'Desk',
                    description: 'What is going out, what needs you, and what is next',
                    onClick: () => void navigate({ to: '/' }),
                },
            ],
        },
        {
            group: 'Programme',
            actions: PROGRAMME_TABS.map(tab => ({
                id: `programme:${tab.key}`,
                label: tab.label,
                description: 'Programme',
                // No `replace`, unlike the tab strip. A strip replaces because stepping between
                // three tabs should not become three back-button presses to leave the destination.
                // A jump from the palette comes from somewhere else entirely, and replacing that
                // entry is how Back stops taking you where you were.
                onClick: () => void navigate({ to: '/schedule', search: { tab: tab.key } }),
            })),
        },
        {
            group: 'Library',
            actions: LIBRARY_TABS.map(tab => ({
                id: `library:${tab.key}`,
                label: tab.label,
                description: 'Library',
                onClick: () => void navigate({ to: LIBRARY_ROUTES[tab.key] }),
            })),
        },
        {
            group: 'Voice',
            actions: VOICE_TABS.map(tab => ({
                id: `voice:${tab.key}`,
                label: tab.label,
                description: 'Voice',
                // Unnarrowed, like every other jump: the palette is how somebody asks for the whole
                // of What it said, not for the one break a link happened to leave in the URL.
                onClick: () => void navigate({ to: '/voice', search: { tab: tab.key, segment: '', persona: '' } }),
            })),
        },
        {
            group: 'Check-up',
            actions: CHECKUP_TABS.map(tab => ({
                id: `checkup:${tab.key}`,
                label: tab.label,
                description: 'Check-up',
                onClick: () => void navigate({ to: CHECKUP_ROUTES[tab.key] }),
            })),
        },
        {
            group: 'Settings',
            actions: [
                // Plugins is one of these rather than an entry appended after them: it is a
                // section of Settings that happens to have been a route first, and the list says so.
                ...SETTINGS_SECTIONS.map(section => ({
                    id: `settings:${section.id}`,
                    label: section.label,
                    description: 'Settings',
                    // A route rather than a hash: these are pages now, so the palette lands on the
                    // section itself instead of scrolling one long page to an anchor on it.
                    onClick: () => void navigate({ to: SETTINGS_ROUTES[section.id] }),
                })),
            ],
        },
    ];

    const resultGroups: SpotlightActionGroupData[] = searching
        ? [
              {
                  group: 'Records',
                  actions: (tracks.data?.data ?? []).map(track => ({
                      id: `track:${track.id}`,
                      label: track.title,
                      description: track.artistName,
                      onClick: () => void navigate({ to: '/catalog/tracks/$trackId', params: { trackId: track.id } }),
                  })),
              },
              {
                  group: 'Artists',
                  actions: (artists.data?.data ?? []).map(artist => ({
                      id: `artist:${artist.id}`,
                      label: artist.name,
                      description: 'Artist',
                      onClick: () => void navigate({ to: '/catalog/artists/$artistId', params: { artistId: artist.id }, search: CATALOG_ALBUM_DEFAULTS }),
                  })),
              },
              {
                  group: 'Characters',
                  actions: (personas.data?.personas ?? [])
                      .filter(persona => persona.label.toLowerCase().includes(debounced.trim().toLowerCase()))
                      .slice(0, RESULT_LIMIT)
                      .map(persona => ({
                          id: `persona:${persona.key}`,
                          label: persona.label,
                          description: persona.kind === 'caller' ? 'Caller' : 'Host',
                          onClick: () => void navigate({ to: '/voice', search: { tab: 'characters', segment: '', persona: persona.key } }),
                      })),
              },
          ]
        : [];

    return (
        <Spotlight
            actions={[...resultGroups, ...pageGroups]}
            query={query}
            onQueryChange={setQuery}
            shortcut="mod + K"
            nothingFound={
                searching && (tracks.isFetching || artists.isFetching) ? 'Searching…' : 'No page, record or character by that name.'
            }
            highlightQuery
            scrollable
            maxHeight={420}
            searchProps={{ placeholder: 'Jump to anything' }}
        />
    );
}
