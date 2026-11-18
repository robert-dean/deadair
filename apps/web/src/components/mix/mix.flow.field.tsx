import { lazy, Suspense, useState } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { IconSparkles } from '@tabler/icons-react';
import type { MixFlow } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { Eyebrow } from '../shared/eyebrow';
import { MixOutline } from './mix.outline.list';
import type { ShowPeriod } from './mix.node';

/** Loaded when first opened, so the canvas library is not in every page's first download. */
const MixFlowEditor = lazy(async () => ({ default: (await import('./mix.flow.editor')).MixFlowEditor }));

/**
 * A show's mix flow on the slot editor: what it has, and the canvas that draws it.
 *
 * The flow is part of the form and saved with the show, so drawing one and then closing the editor
 * without saving keeps nothing, as with every other field here. Removing it sends a flow with no nodes,
 * which is how the station is told to clear one: a save that says nothing keeps what the show had.
 */
export function MixFlowField({ value, onChange, showName, brief, period, changed }: Props) {
    const { t } = useTranslation('mix');
    const [open, setOpen] = useState(false);
    // Opened by "Draft from the brief" rather than to draw, so the canvas starts a draft as it opens.
    const [drafting, setDrafting] = useState(false);
    const hasBrief = (brief ?? '').trim().length > 0;
    const nodes = value?.nodes.length ?? 0;

    return (
        <Stack gap="xs">
            <Eyebrow>{t('field.title')}</Eyebrow>
            <Text size="xs" c="dimmed">
                {t('field.description')}
            </Text>
            {/* The flow as a list, with its common settings editable here; the canvas is for the wiring. */}
            {value === undefined || nodes === 0 ? <Text size="sm">{t('field.none')}</Text> : <MixOutline flow={value} onChange={onChange} />}
            {changed ? (
                <Text size="xs" c="dimmed">
                    {t('field.unsaved')}
                </Text>
            ) : undefined}
            <Group gap="xs">
                <Button
                    size="xs"
                    variant="light"
                    onClick={() => {
                        setDrafting(false);
                        setOpen(true);
                    }}
                >
                    {nodes === 0 ? t('field.create') : t('field.open')}
                </Button>
                {nodes === 0 && hasBrief ? (
                    <Button
                        size="xs"
                        variant="light"
                        color="grape"
                        leftSection={<IconSparkles size={14} />}
                        onClick={() => {
                            setDrafting(true);
                            setOpen(true);
                        }}
                    >
                        {t('field.draft')}
                    </Button>
                ) : undefined}
                {nodes === 0 ? undefined : (
                    <Button size="xs" variant="subtle" color="gray" onClick={() => onChange({ version: 1, nodes: [], links: [] })}>
                        {t('field.clear')}
                    </Button>
                )}
            </Group>
            {open ? (
                <Suspense fallback={undefined}>
                    <MixFlowEditor
                        opened={open}
                        flow={nodes === 0 ? undefined : value}
                        {...(showName ? { title: showName } : {})}
                        {...(brief === undefined ? {} : { brief })}
                        {...(period === undefined ? {} : { period })}
                        draftOnOpen={drafting}
                        onClose={() => setOpen(false)}
                        onDone={flow => {
                            onChange(flow);
                            setOpen(false);
                        }}
                    />
                </Suspense>
            ) : undefined}
        </Stack>
    );
}

interface Props {
    /** The show's flow as the form holds it. Absent, or one with no nodes, is none. */
    value: MixFlow | undefined;
    onChange: (flow: MixFlow) => void;
    showName?: string;
    /** The show's brief as the form holds it, which a draft is made from. */
    brief?: string;
    /** The show's period, which Picks shows beside the brief. */
    period?: ShowPeriod;
    /** Whether it differs from what was saved, which the line under the list says. */
    changed?: boolean;
}
