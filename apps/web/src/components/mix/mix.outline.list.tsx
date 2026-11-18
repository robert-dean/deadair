import type { ReactNode } from 'react';
import { Badge, Group, NumberInput, Stack, TagsInput, Text } from '@mantine/core';
import type { MixFlow, MixNode } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { mixOutline, type OutlineLine } from './mix.outline';

/** The width of one step of indentation. */
const INDENT = 18;

/**
 * A show's mix flow as a list on the show's page, with the three settings changed most often editable
 * where they are read: a Block's bands, a Limit share's percent and a Require's point in the show.
 * Everything else, and anything the list cannot show, is the canvas's.
 */
export function MixOutline({ flow, onChange }: { flow: MixFlow; onChange: (flow: MixFlow) => void }) {
    const { t } = useTranslation('mix');
    const lines = mixOutline(flow);
    const set = (next: MixNode) => onChange({ ...flow, nodes: flow.nodes.map(node => (node.id === next.id ? next : node)) });

    if (lines === undefined) {
        return (
            <Text size="sm" c="dimmed">
                {t('field.unlistable')}
            </Text>
        );
    }

    return (
        <Stack gap={6} component="ul" aria-label={t('field.outlineLabel')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {lines.map(line => (
                <Group
                    key={line.kind === 'node' ? line.node.id : `${line.split.id}:${line.index}`}
                    component="li"
                    gap="xs"
                    wrap="nowrap"
                    pl={line.depth * INDENT}
                    style={line.kind === 'node' && line.node.bypassed === true ? { opacity: 0.55 } : undefined}
                >
                    <Line line={line} set={set} />
                </Group>
            ))}
        </Stack>
    );
}

function Line({ line, set }: { line: OutlineLine; set: (node: MixNode) => void }) {
    const { t } = useTranslation('mix');

    if (line.kind === 'branch') {
        const branches = line.split.branches ?? [];
        const branch = branches[line.index];
        const words =
            branch === undefined
                ? t('outline.everythingElse')
                : (branch.values?.length ?? 0) > 0
                  ? t('outline.branch', { match: (branch.values ?? []).join(', ') })
                  : t('outline.branchRange', { min: branch.min ?? 0, max: branch.max ?? '…' });
        return (
            <Text size="sm" fw={600} c="dimmed">
                {words}
            </Text>
        );
    }

    const { node } = line;
    const per = t(`outline.per.${node.per ?? 'show'}`);
    const bypassed =
        node.bypassed === true ? (
            <Badge size="xs" variant="light" color="yellow">
                {t('outline.bypassed')}
            </Badge>
        ) : undefined;
    const said = (words: ReactNode) => (
        <>
            <Text size="sm">{words}</Text>
            {bypassed}
        </>
    );

    switch (node.kind) {
        case 'block':
            return (
                <>
                    <Text size="sm">{t('outline.block')}</Text>
                    <TagsInput
                        size="xs"
                        aria-label={t('outline.bandsLabel')}
                        value={node.bands ?? []}
                        onChange={bands => set({ ...node, bands })}
                        style={{ flex: 1, maxWidth: 420 }}
                    />
                    {bypassed}
                </>
            );
        case 'split':
            return said(t('outline.split', { by: node.splitBy === undefined ? '…' : t(`splitBy.${node.splitBy}`) }));
        case 'limitShare': {
            const fed = line.amountFrom;
            if (fed?.kind === 'timeSwitch' && fed.bypassed !== true) {
                return said(
                    t('outline.limitShareSwitched', {
                        then: fed.thenValue ?? 0,
                        otherwise: fed.elseValue ?? 0,
                        hour: String(fed.fromHour ?? 0).padStart(2, '0'),
                        per,
                    }),
                );
            }
            return (
                <>
                    <Text size="sm">{t('outline.limitShare')}</Text>
                    <NumberInput
                        size="xs"
                        w={170}
                        min={0}
                        max={100}
                        prefix={t('outline.sharePrefix')}
                        suffix={t('outline.shareSuffix', { per })}
                        aria-label={t('outline.percentLabel')}
                        value={node.percent ?? ''}
                        onChange={value => set({ ...node, ...(typeof value === 'number' ? { percent: value } : { percent: undefined }) })}
                    />
                    {bypassed}
                </>
            );
        }
        case 'limitCount':
            return said(t('outline.limitCount', { count: node.count ?? 0, per }));
        case 'noRepeat':
            return said(t('outline.noRepeat'));
        case 'require':
            return (
                <>
                    <Text size="sm">
                        {t('outline.require', {
                            what: (node.requireGenres?.length ?? 0) > 0 ? (node.requireGenres ?? []).join(', ') : t('outline.requireAnything'),
                        })}
                    </Text>
                    <NumberInput
                        size="xs"
                        w={170}
                        min={0}
                        max={100}
                        prefix={t('outline.afterPrefix')}
                        suffix={t('outline.afterSuffix')}
                        aria-label={t('outline.afterLabel')}
                        value={node.afterPercent ?? 0}
                        onChange={value => set({ ...node, afterPercent: typeof value === 'number' ? value : 0 })}
                    />
                    {bypassed}
                </>
            );
        default:
            return said(t(`kinds.${node.kind}`));
    }
}
