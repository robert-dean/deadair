import { Fragment, useState } from 'react';
import { NavLink, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Eyebrow } from '../shared/eyebrow';
import { SETTINGS_RAIL_GROUPS, SETTINGS_ROUTES, SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionId } from './settings.shell';

/**
 * Whether a section answers what was typed: its name or the sentence saying what it holds.
 *
 * The sentence counts because the names are short and several name a subject rather than a setting:
 * somebody looking for the model types "model", which is in the hint of "Words" and the name of
 * nothing.
 */
export function sectionMatches(section: Pick<SettingsSection, 'label' | 'hint'>, query: string): boolean {
    const wanted = query.trim().toLocaleLowerCase();
    if (wanted === '') return true;
    return section.label.toLocaleLowerCase().includes(wanted) || section.hint.toLocaleLowerCase().includes(wanted);
}

export interface SettingsSectionNavProps {
    /** The section being read, lit in the list. */
    active?: SettingsSectionId;
}

/**
 * Settings' sections, beside the one being read, on a desk.
 *
 * The rail listed them, which was the only place 22 sections fit, until the rail gave way to tabs in
 * the header: a tab strip of 22 is the shape this destination already tried and dropped (see
 * `settings.shell.tsx`). So Settings keeps a column of its own, grouped under the same headings the
 * rail used, with a search box over it because 22 is too many to read down for one setting.
 *
 * A phone does not draw this: there, `/settings` IS the list (`SettingsIndex`), and each section has
 * a way back to it.
 */
export function SettingsSectionNav({ active }: SettingsSectionNavProps) {
    const { t } = useTranslation('settings');
    const [query, setQuery] = useState('');
    const shown = SETTINGS_SECTIONS.filter(section => sectionMatches(section, query));

    return (
        <Stack gap={2} component="nav" aria-label={t('sectionNav.label')}>
            <TextInput
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
                placeholder={t('sectionNav.search')}
                aria-label={t('sectionNav.search')}
                leftSection={<IconSearch aria-hidden size={14} stroke={2} />}
                size="sm"
                mb="xs"
            />
            {shown.length === 0 ? (
                <Text size="sm" c="dimmed" px="xs">
                    {t('sectionNav.nothing')}
                </Text>
            ) : undefined}
            {shown.map((section, index) => {
                const group = SETTINGS_RAIL_GROUPS[section.id];
                const heading = group !== (index === 0 ? undefined : SETTINGS_RAIL_GROUPS[shown[index - 1]!.id]);
                return (
                    <Fragment key={section.id}>
                        {heading ? (
                            <Eyebrow px="xs" pt={index === 0 ? 0 : 'sm'} pb={2} display="block">
                                {t(`railGroup.${group}`)}
                            </Eyebrow>
                        ) : undefined}
                        <NavLink
                            label={section.label}
                            title={section.hint}
                            active={section.id === active}
                            variant="light"
                            py={5}
                            renderRoot={(props: object) => <Link to={SETTINGS_ROUTES[section.id]} {...props} />}
                        />
                    </Fragment>
                );
            })}
        </Stack>
    );
}
