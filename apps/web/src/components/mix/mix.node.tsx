import type { ReactNode } from 'react';
import { ActionIcon, Badge, Button, Group, NumberInput, Select, TagsInput, Text, TextInput, Tooltip } from '@mantine/core';
import { Handle, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react';
import { IconLock, IconPlugConnectedX, IconPower, IconTrash, IconX } from '@tabler/icons-react';
import type { MixBranch, MixNode } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { canBypass, SPLIT_BY_VALUES, socketsOf, songOf, songText, type FlowProblem, type SocketType } from './mix.kinds';
import classes from './mix.flow.module.css';

/** What the canvas hands each node: the node itself, its problems, and how to change it. */
export interface MixNodeData extends Record<string, unknown> {
    node: MixNode;
    problems: readonly FlowProblem[];
    /** Drawn from the phrase the operator is pointing at in the draft's readings. */
    lit?: boolean;
    onChange: (next: MixNode, relink?: { removed: number } | { addedAt: number }) => void;
    /** The problems on this node, worded, so they can be drawn on it as well as in the strip. */
    problemTexts: readonly string[];
    /** Take every wire into and out of this node off. */
    onUnwire: (id: string) => void;
    onRemove: (id: string) => void;
    /** For Picks: what the show form says it proposes from, shown and never edited here. */
    show?: { brief: string; period?: ShowPeriod };
}

/** A show's period as two years, either of which may be absent. */
export interface ShowPeriod {
    from?: number;
    to?: number;
}

export type MixFlowNode = Node<MixNodeData, 'mix'>;

/** The tally colour each kind's dot wears: what it does, at a glance. */
const DOT: Record<MixNode['kind'], string> = {
    picks: 'var(--mantine-color-grape-5)',
    onAir: 'var(--da-phosphor)',
    block: 'var(--mantine-color-red-6)',
    split: 'var(--da-phosphor)',
    limitShare: 'var(--mantine-color-orange-6)',
    limitCount: 'var(--mantine-color-orange-6)',
    noRepeat: 'var(--mantine-color-red-6)',
    merge: 'var(--da-phosphor)',
    require: 'var(--mantine-color-teal-6)',
    timeSwitch: 'var(--mantine-color-orange-6)',
};

/** Inputs inside a node take the pointer for themselves rather than dragging the node. */
const EDITABLE = 'nodrag nowheel';

/**
 * One node on the canvas: its title, its sockets as handles on the edges, and its settings as small
 * inputs inside it, so the whole flow reads off the canvas without a side panel.
 */
export function MixNodeView({ data, selected }: NodeProps<MixFlowNode>) {
    const { t } = useTranslation('mix');
    const { node, problems, onChange } = data;
    const { ins, outs } = socketsOf(node);
    const set = (part: Partial<MixNode>) => onChange({ ...node, ...part } as MixNode);
    const bypassed = node.bypassed === true;
    const fixed = node.kind === 'picks' || node.kind === 'onAir';

    return (
        <div
            className={classes.node}
            data-selected={selected === true}
            data-problem={problems.length > 0}
            data-lit={data.lit === true}
            data-bypassed={bypassed}
        >
            {/* Over the node while it is selected: what can be done to it, here rather than in a menu. */}
            <NodeToolbar position={Position.Top} offset={8}>
                <Group gap={4} className={classes.toolbar} role="toolbar" aria-label={t('toolbar.label')}>
                    {fixed ? (
                        <Group gap={4} px={6}>
                            <IconLock size={12} aria-hidden />
                            <Text size="xs" c="dimmed">
                                {t('toolbar.fixed')}
                            </Text>
                        </Group>
                    ) : (
                        <>
                            {canBypass(node) ? (
                                <Tooltip label={t('toolbar.bypassHint')} multiline w={240} disabled={bypassed}>
                                    <Button
                                        size="compact-xs"
                                        variant={bypassed ? 'filled' : 'subtle'}
                                        color={bypassed ? 'yellow' : 'gray'}
                                        leftSection={<IconPower size={12} />}
                                        onClick={() => set({ bypassed: bypassed ? undefined : true })}
                                    >
                                        {bypassed ? t('toolbar.restore') : t('toolbar.bypass')}
                                    </Button>
                                </Tooltip>
                            ) : undefined}
                            <Button
                                size="compact-xs"
                                variant="subtle"
                                color="gray"
                                leftSection={<IconPlugConnectedX size={12} />}
                                onClick={() => data.onUnwire(node.id)}
                            >
                                {t('toolbar.unwire')}
                            </Button>
                            <Button
                                size="compact-xs"
                                variant="subtle"
                                color="red"
                                leftSection={<IconTrash size={12} />}
                                onClick={() => data.onRemove(node.id)}
                            >
                                {t('toolbar.remove')}
                            </Button>
                        </>
                    )}
                </Group>
            </NodeToolbar>
            <div className={classes.title}>
                <span className={classes.dot} style={{ background: DOT[node.kind] }} />
                <span>{t(`kinds.${node.kind}`)}</span>
                {bypassed ? (
                    <Badge size="xs" variant="light" color="yellow" ml="auto">
                        {t('bypassed')}
                    </Badge>
                ) : undefined}
            </div>
            {data.problemTexts.length === 0 ? undefined : (
                <div className={classes.callout}>
                    {data.problemTexts.map(text => (
                        <Text key={text} size="xs" c="red">
                            {text}
                        </Text>
                    ))}
                </div>
            )}
            {node.fromBrief === undefined || node.fromBrief.length === 0 ? undefined : (
                <div className={classes.from} title={node.fromBrief}>
                    {t('draft.quoted', { quote: node.fromBrief })}
                </div>
            )}
            <div className={classes.body}>
                {node.kind === 'picks' && data.show !== undefined ? <PicksShow show={data.show} /> : undefined}
                {node.kind === 'picks' ? (
                    <>
                        {/* Drawn, never stored: what each limit has left reaches the model here. */}
                        <Socket side="in" index="budget" type="budget" label={t('sockets.budget')} />
                        <Socket side="out" index={0} type="records" label={t('sockets.records')} />
                    </>
                ) : undefined}

                {node.kind === 'merge' ? (
                    ins.map((type, index) => <Socket key={index} side="in" index={index} type={type} label={t('sockets.records')} />)
                ) : node.kind !== 'picks' && ins[0] !== undefined ? (
                    <Socket side="in" index={0} type={ins[0]} label={t('sockets.records')} />
                ) : undefined}

                <NodeFields node={node} set={set} onChange={onChange} />

                {node.kind === 'limitShare' ? <Socket side="in" index={1} type="number" label={t('sockets.share')} /> : undefined}

                {node.kind === 'split' || node.kind === 'picks'
                    ? undefined
                    : outs.map((type, index) => (
                          <Socket
                              key={index}
                              side="out"
                              index={index}
                              type={type}
                              label={type === 'number' ? t('sockets.number') : t('sockets.records')}
                          />
                      ))}

                {node.kind === 'split' ? <Socket side="out" index={outs.length - 1} type="records" label={t('sockets.everythingElse')} /> : undefined}
            </div>
        </div>
    );
}

/**
 * What Picks proposes from, as the show's own form has it: the brief and the period. Read-only here,
 * because they are the show's and are edited on its page; the canvas only shows where records come from.
 */
function PicksShow({ show }: { show: { brief: string; period?: ShowPeriod } }) {
    const { t } = useTranslation('mix');
    const { from, to } = show.period ?? {};
    const period =
        from !== undefined && to !== undefined
            ? t('picks.period', { from, to })
            : from !== undefined
              ? t('picks.periodFrom', { from })
              : to !== undefined
                ? t('picks.periodTo', { to })
                : undefined;
    return (
        <div className={classes.picksShow}>
            <Text size="xs" c="dimmed" lineClamp={3}>
                {show.brief.trim() ? t('picks.brief', { brief: show.brief.trim() }) : t('picks.noBrief')}
            </Text>
            {period === undefined ? undefined : (
                <Text size="xs" c="dimmed">
                    {period}
                </Text>
            )}
            <Text size="xs" c="dimmed" fs="italic">
                {t('picks.fromShow')}
            </Text>
        </div>
    );
}

/** A labelled socket, its handle on the node's edge. */
function Socket({ side, index, type, label }: { side: 'in' | 'out'; index: number | 'budget'; type: SocketType | 'budget'; label: string }) {
    return (
        <div className={`${classes.socket} ${side === 'out' ? classes.socketOut : ''}`}>
            <Handle
                id={`${side}-${index}`}
                type={side === 'in' ? 'target' : 'source'}
                position={side === 'in' ? Position.Left : Position.Right}
                className={`${classes.handle} ${classes[type]}`}
                style={side === 'in' ? { left: -16 } : { right: -16 }}
                isConnectable={type !== 'budget'}
            />
            <Text size="xs" c="dimmed">
                {label}
            </Text>
        </div>
    );
}

/** The settings each kind has, as inputs inside the node. */
function NodeFields({ node, set, onChange }: { node: MixNode; set: (part: Partial<MixNode>) => void; onChange: MixNodeData['onChange'] }) {
    const { t } = useTranslation('mix');
    const per = (
        <Select
            className={EDITABLE}
            size="xs"
            label={t('fields.per')}
            data={[
                { value: 'show', label: t('fields.perShow') },
                { value: 'hour', label: t('fields.perHour') },
            ]}
            value={node.per ?? 'show'}
            onChange={value => set({ per: value === 'hour' ? 'hour' : 'show' })}
            allowDeselect={false}
        />
    );

    switch (node.kind) {
        case 'block':
            return (
                <TagsInput
                    className={EDITABLE}
                    size="xs"
                    label={t('fields.bands')}
                    placeholder={t('fields.bandsPlaceholder')}
                    value={node.bands ?? []}
                    onChange={bands => set({ bands })}
                />
            );
        case 'limitShare':
            return (
                <Group gap="xs" grow>
                    <Amount label={t('fields.percent')} value={node.percent} max={100} onChange={percent => set({ percent })} />
                    {per}
                </Group>
            );
        case 'limitCount':
            return (
                <Group gap="xs" grow>
                    <Amount
                        label={t('fields.count')}
                        value={node.count}
                        max={1000}
                        onChange={count => set({ count: count === undefined ? undefined : Math.round(count) })}
                    />
                    {per}
                </Group>
            );
        case 'timeSwitch':
            return (
                <>
                    <Amount
                        label={t('fields.fromHour')}
                        value={node.fromHour}
                        max={23}
                        onChange={fromHour => set({ fromHour: fromHour === undefined ? undefined : Math.round(fromHour) })}
                    />
                    <Group gap="xs" grow>
                        <Amount label={t('fields.thenValue')} value={node.thenValue} max={100} onChange={thenValue => set({ thenValue })} />
                        <Amount label={t('fields.elseValue')} value={node.elseValue} max={100} onChange={elseValue => set({ elseValue })} />
                    </Group>
                </>
            );
        case 'require':
            return (
                <>
                    <TagsInput
                        className={EDITABLE}
                        size="xs"
                        label={t('fields.genres')}
                        placeholder={t('fields.genresPlaceholder')}
                        value={node.requireGenres ?? []}
                        onChange={requireGenres => set({ requireGenres })}
                    />
                    <Select
                        className={EDITABLE}
                        size="xs"
                        label={t('fields.mode')}
                        data={[
                            { value: 'any', label: t('fields.modeAny') },
                            { value: 'each', label: t('fields.modeEach') },
                        ]}
                        value={node.requireMode ?? 'any'}
                        onChange={value => set({ requireMode: value === 'each' ? 'each' : 'any' })}
                        allowDeselect={false}
                    />
                    <TagsInput
                        className={EDITABLE}
                        size="xs"
                        label={t('fields.songs')}
                        placeholder={t('fields.songsPlaceholder')}
                        value={(node.songs ?? []).map(songText)}
                        onChange={texts => set({ songs: texts.flatMap(text => songOf(text) ?? []) })}
                    />
                    <Amount label={t('fields.afterPercent')} value={node.afterPercent} max={100} onChange={afterPercent => set({ afterPercent })} />
                </>
            );
        case 'split':
            return <SplitFields node={node} set={set} onChange={onChange} />;
        default:
            return undefined;
    }
}

function Amount({
    label,
    value,
    max,
    onChange,
}: {
    label: string;
    value: number | undefined;
    max: number;
    onChange: (value: number | undefined) => void;
}) {
    return (
        <NumberInput
            className={`${EDITABLE} da-num`}
            size="xs"
            label={label}
            min={0}
            max={max}
            value={value ?? ''}
            onChange={next => onChange(typeof next === 'number' ? next : undefined)}
        />
    );
}

/** A split's basis, its question for the model, and each branch with its output beside it. */
function SplitFields({
    node,
    set,
    onChange,
}: {
    node: MixNode;
    set: (part: Partial<MixNode>) => void;
    onChange: MixNodeData['onChange'];
}): ReactNode {
    const { t } = useTranslation('mix');
    const branches = node.branches ?? [];
    const byValues = node.splitBy === undefined || SPLIT_BY_VALUES.has(node.splitBy);
    const setBranch = (index: number, branch: MixBranch) => set({ branches: branches.map((current, at) => (at === index ? branch : current)) });

    return (
        <>
            <Select
                className={EDITABLE}
                size="xs"
                label={t('fields.splitBy')}
                data={(['genre', 'artist', 'decade', 'hour', 'showProgress', 'lastGenre', 'judged'] as const).map(value => ({
                    value,
                    label: t(`splitBy.${value}`),
                }))}
                value={node.splitBy ?? 'genre'}
                onChange={value => {
                    const splitBy = (value ?? 'genre') as NonNullable<MixNode['splitBy']>;
                    // A branch written for one basis means nothing under another, so a change of basis starts them empty.
                    set({ splitBy, branches: branches.map(() => (splitBy === 'judged' ? { values: ['yes'] } : {})) });
                }}
                allowDeselect={false}
            />
            {node.splitBy === 'judged' ? (
                <TextInput
                    className={EDITABLE}
                    size="xs"
                    label={t('fields.question')}
                    placeholder={t('fields.questionPlaceholder')}
                    value={node.question ?? ''}
                    onChange={event => set({ question: event.currentTarget.value })}
                />
            ) : undefined}
            {branches.map((branch, index) => (
                <div key={index} className={classes.branch}>
                    {node.splitBy === 'judged' ? (
                        <Select
                            className={EDITABLE}
                            size="xs"
                            data={[
                                { value: 'yes', label: t('fields.yes') },
                                { value: 'no', label: t('fields.no') },
                            ]}
                            value={branch.values?.[0] ?? 'yes'}
                            onChange={value => setBranch(index, { values: [value === 'no' ? 'no' : 'yes'] })}
                            allowDeselect={false}
                        />
                    ) : byValues ? (
                        <TagsInput
                            className={EDITABLE}
                            size="xs"
                            placeholder={t('fields.valuesPlaceholder')}
                            aria-label={t('fields.values')}
                            value={branch.values ?? []}
                            onChange={values => setBranch(index, { values })}
                        />
                    ) : (
                        <Group gap="xs" grow>
                            <Amount label={t('fields.from')} value={branch.min} max={100} onChange={min => setBranch(index, { ...branch, min })} />
                            <Amount label={t('fields.to')} value={branch.max} max={100} onChange={max => setBranch(index, { ...branch, max })} />
                        </Group>
                    )}
                    {branches.length > 1 ? (
                        <ActionIcon
                            className={EDITABLE}
                            size="xs"
                            variant="subtle"
                            color="gray"
                            aria-label={t('fields.removeBranch')}
                            onClick={() => onChange({ ...node, branches: branches.filter((_, at) => at !== index) }, { removed: index })}
                            style={{ position: 'absolute', top: 2, right: 2 }}
                        >
                            <IconX size={12} />
                        </ActionIcon>
                    ) : undefined}
                    <Handle
                        id={`out-${index}`}
                        type="source"
                        position={Position.Right}
                        className={`${classes.handle} ${classes.records}`}
                        style={{ right: -24 }}
                    />
                </div>
            ))}
            <Button
                className={EDITABLE}
                size="compact-xs"
                variant="subtle"
                onClick={() =>
                    onChange(
                        { ...node, branches: [...branches, node.splitBy === 'judged' ? { values: ['no'] } : byValues ? { values: [] } : {}] },
                        { addedAt: branches.length },
                    )
                }
            >
                {t('fields.addBranch')}
            </Button>
        </>
    );
}
