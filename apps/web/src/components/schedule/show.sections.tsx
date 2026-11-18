import type { ReactNode } from 'react';
import { Badge, Group, NavLink, Stack, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';

/** The parts a show's page is divided into, in the order they are drawn. */
export const SHOW_SECTIONS = ['when', 'presents', 'music', 'says', 'sound', 'repeat'] as const;

export type ShowSection = (typeof SHOW_SECTIONS)[number];

/** The two a show cannot be saved without: its name and times, and somebody (or the station) to present it. */
const REQUIRED: ReadonlySet<ShowSection> = new Set(['when', 'presents']);

/** The element id a section is drawn under, so the list beside the form can scroll to it. */
export const sectionId = (section: ShowSection): string => `show-${section}`;

/**
 * Which sections a show draws, given what it is.
 *
 * A live special is only its when-half: nothing of its own airs, so every programme section goes. The
 * repeat rules are a rotation's alone, since only a rotation picks its own records.
 */
export function showSectionsOf({ live, mode }: { live: boolean; mode: string }): ShowSection[] {
    if (live) return ['when'];
    return SHOW_SECTIONS.filter(section => section !== 'repeat' || mode === 'rotation');
}

/** One part of the show's page: a heading, marked when the show needs it, and its fields. */
export function ShowSectionFrame({ section, children }: { section: ShowSection; children: ReactNode }) {
    const { t } = useTranslation('schedule');
    const heading = `${sectionId(section)}-heading`;

    return (
        <Stack component="section" id={sectionId(section)} aria-labelledby={heading} gap="md" style={{ scrollMarginTop: 72 }}>
            <Group gap="xs">
                <Title order={2} size="h4" id={heading}>
                    {t(`slot.sections.${section}`)}
                </Title>
                {REQUIRED.has(section) ? (
                    <Badge size="xs" variant="light" color="gray">
                        {t('slot.sections.required')}
                    </Badge>
                ) : undefined}
            </Group>
            {children}
        </Stack>
    );
}

/**
 * The list of sections beside the form, each scrolling the page to its own.
 *
 * Buttons rather than fragment links: a `#when` in the address is a navigation as far as the router is
 * concerned, and on a page holding an unsaved edit the guard would ask about it.
 */
export function ShowSectionNav({ sections }: { sections: readonly ShowSection[] }) {
    const { t } = useTranslation('schedule');

    return (
        <Stack component="nav" aria-label={t('slot.sections.label')} gap={2}>
            {sections.map(section => (
                <NavLink
                    key={section}
                    component="button"
                    type="button"
                    label={t(`slot.sections.${section}`)}
                    onClick={() => document.getElementById(sectionId(section))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                />
            ))}
        </Stack>
    );
}
