import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Group, List, Modal, Popover, Stack, Text, Title, Tooltip } from '@mantine/core';
import { IconPlus, IconSparkles } from '@tabler/icons-react';
import {
    Background,
    Controls,
    MarkerType,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Connection,
    type Edge,
    type EdgeChange,
    type IsValidConnection,
    type OnConnectEnd,
    type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MixDraftReading, MixFlow, MixLink, MixNode } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useDraftMixFlow } from '../../api/schedule.queries';
import { useTheme } from '../../theme.store';
import { ErrorAlert } from '../shared/error.alert';
import { AddRule } from './mix.add';
import { MixReadings } from './mix.readings';
import {
    flowProblems,
    freshNode,
    nextId,
    relinkSplit,
    socketsOf,
    starterFlow,
    unwire,
    type FlowProblem,
    type MixKind,
    type SocketType,
} from './mix.kinds';
import { MixNodeView, type MixFlowNode, type ShowPeriod } from './mix.node';
import classes from './mix.flow.module.css';

const NODE_TYPES = { mix: MixNodeView };

/** Far enough out that a drafted flow, about a dozen nodes in a row, fits the canvas whole. */
const MIN_ZOOM = 0.2;

/** A link's edge id: stable for the same wire, so React Flow keeps its selection across a redraw. */
const edgeId = (link: MixLink) => `${link.from}:${link.out}->${link.to}:${link.in}`;

/** A handle id back to its socket number, or nothing for the drawn-only budget socket. */
const socketOf = (handle: string | null | undefined): number | undefined => {
    const index = Number(handle?.split('-')[1]);
    return Number.isInteger(index) ? index : undefined;
};

/**
 * A show's mix flow on a canvas: the nodes it has, the wires between them, and what would stop it
 * running, marked on the node as it is drawn.
 *
 * Edits a copy, handed back by {@link Props.onDone}; the slot editor saves it with the show, which is
 * where the station's own check refuses anything this one missed. The dashed wires from each limit back
 * to Picks are drawn and never stored: they are what the station tells the model about what each limit
 * has left.
 */
export function MixFlowEditor({ opened, flow, title, brief, period, draftOnOpen, onDone, onClose }: Props) {
    const { t } = useTranslation('mix');
    return (
        <Modal
            opened={opened}
            onClose={onClose}
            fullScreen
            withCloseButton={false}
            // The canvas draws its own heading, as a page would; this names the dialog for a screen reader.
            aria-label={title ? t('editor.titleNamed', { show: title }) : t('editor.title')}
            closeOnEscape={false}
        >
            {opened ? (
                <ReactFlowProvider>
                    <Canvas
                        {...(title === undefined ? {} : { title })}
                        initial={flow ?? starterFlow()}
                        brief={brief ?? ''}
                        {...(period === undefined ? {} : { period })}
                        draftOnOpen={draftOnOpen === true}
                        onDone={onDone}
                        onClose={onClose}
                    />
                </ReactFlowProvider>
            ) : undefined}
        </Modal>
    );
}

interface Props {
    opened: boolean;
    /** The show's flow, or nothing for a show that has none yet, which starts from Picks wired to On air. */
    flow: MixFlow | undefined;
    title?: string;
    /** The show's brief as the editor holds it, saved or not, which a draft is made from. */
    brief?: string;
    /** Start a draft from the brief as soon as the canvas opens. */
    draftOnOpen?: boolean;
    /** The show's period, which Picks shows beside the brief. */
    period?: ShowPeriod;
    onDone: (flow: MixFlow) => void;
    onClose: () => void;
}

interface CanvasProps {
    title?: string;
    initial: MixFlow;
    brief: string;
    period?: ShowPeriod;
    draftOnOpen: boolean;
    onDone: (flow: MixFlow) => void;
    onClose: () => void;
}

function Canvas({ title, initial, brief, period, draftOnOpen, onDone, onClose }: CanvasProps) {
    const { t } = useTranslation('mix');
    const theme = useTheme();
    const { screenToFlowPosition, fitView, getNodes, getInternalNode } = useReactFlow();
    const [flow, setFlow] = useState<MixFlow>(initial);
    const problems = useMemo(() => flowProblems(flow), [flow]);

    // A draft replaces the drawing and brings what the model read of each phrase, its questions among them.
    const drafting = useDraftMixFlow();
    const [readings, setReadings] = useState<MixDraftReading[] | undefined>();
    const [model, setModel] = useState<string | undefined>();
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [lit, setLit] = useState<readonly string[]>([]);
    const [confirming, setConfirming] = useState(false);
    const canDraft = brief.trim().length > 0;
    const drawn = flow.nodes.length > 2 || flow.links.length > 1;

    const draft = useCallback(
        (withAnswers: Record<string, string>) => {
            const answered = Object.entries(withAnswers).map(([question, answer]) => ({ question, answer }));
            drafting.mutate(
                { brief: brief.trim(), ...(answered.length === 0 ? {} : { answers: answered }) },
                {
                    onSuccess: answer => {
                        setFlow(answer.flow);
                        setReadings(answer.readings);
                        setModel(answer.model);
                        setLit([]);
                        refit.current = true;
                    },
                },
            );
        },
        [brief, drafting],
    );

    // A draft lays out a whole new flow, so the view fits it once React Flow has measured every node
    // in it, which it reports as `dimensions` changes (`onNodesChange`). Fitting any sooner fits the
    // nodes being replaced, and `useNodesInitialized` still answers for those on the render the new
    // ones arrive.
    const refit = useRef(false);
    const fitWhenMeasured = useCallback(() => {
        if (!refit.current) return;
        requestAnimationFrame(() => {
            // The nodes handed to React Flow are rebuilt from the flow on every render and carry no
            // size; React Flow keeps what it measured on its own copy.
            const measured = getNodes().every(node => getInternalNode(node.id)?.measured.width !== undefined);
            if (!refit.current || !measured) return;
            refit.current = false;
            void fitView({ padding: 0.1, minZoom: MIN_ZOOM });
        });
    }, [fitView, getNodes, getInternalNode]);

    const opening = useRef(draftOnOpen && canDraft);
    useEffect(() => {
        if (!opening.current) return;
        opening.current = false;
        draft({});
    }, [draft]);

    const changeNode = useCallback((next: MixNode, relink?: { removed: number } | { addedAt: number }) => {
        setFlow(current => ({
            ...current,
            nodes: current.nodes.map(node => (node.id === next.id ? next : node)),
            links: relink === undefined ? current.links : relinkSplit(current.links, next.id, relink),
        }));
    }, []);

    const unwireNode = useCallback((id: string) => setFlow(current => ({ ...current, links: unwire(current.links, id) })), []);
    const removeNode = useCallback(
        (id: string) => setFlow(current => ({ ...current, nodes: current.nodes.filter(node => node.id !== id), links: unwire(current.links, id) })),
        [],
    );

    const nodes: MixFlowNode[] = useMemo(
        () =>
            flow.nodes.map(node => ({
                id: node.id,
                type: 'mix' as const,
                position: { x: node.x ?? 0, y: node.y ?? 0 },
                // Picks and On air are what every flow is; removing either leaves nothing that can run.
                deletable: node.kind !== 'picks' && node.kind !== 'onAir',
                data: {
                    node,
                    problems: problems.filter(problem => problem.nodeId === node.id),
                    problemTexts: problems.filter(problem => problem.nodeId === node.id).map(problem => problemText(t, problem, flow.nodes)),
                    lit: lit.includes(node.id),
                    ...(node.kind === 'picks' ? { show: { brief, ...(period === undefined ? {} : { period }) } } : {}),
                    onChange: changeNode,
                    onUnwire: unwireNode,
                    onRemove: removeNode,
                },
            })),
        [flow.nodes, problems, lit, changeNode, unwireNode, removeNode, t, brief, period],
    );

    const edges: Edge[] = useMemo(() => {
        const wires: Edge[] = flow.links.map(link => {
            const from = flow.nodes.find(node => node.id === link.from);
            const number = from !== undefined && socketsOf(from).outs[link.out] === 'number';
            return {
                id: edgeId(link),
                source: link.from,
                sourceHandle: `out-${link.out}`,
                target: link.to,
                targetHandle: `in-${link.in}`,
                markerEnd: { type: MarkerType.ArrowClosed },
                // Records solid, a number dashed, and what the model is told dotted: three kinds of wire
                // an operator can tell apart without reading the sockets they join.
                ...(number ? { style: NUMBER_WIRE } : {}),
            };
        });
        const picks = flow.nodes.find(node => node.kind === 'picks');
        const budget: Edge[] =
            picks === undefined
                ? []
                : flow.nodes
                      .filter(node => node.kind === 'limitShare' || node.kind === 'limitCount')
                      .map(node => ({
                          id: `budget:${node.id}`,
                          source: node.id,
                          sourceHandle: 'out-0',
                          target: picks.id,
                          targetHandle: 'in-budget',
                          type: 'default',
                          animated: true,
                          selectable: false,
                          deletable: false,
                          focusable: false,
                          style: BUDGET_WIRE,
                      }));
        return [...wires, ...budget];
    }, [flow.links, flow.nodes]);

    const onNodesChange = useCallback(
        (changes: NodeChange<MixFlowNode>[]) => {
            if (changes.some(change => change.type === 'dimensions')) fitWhenMeasured();
            setFlow(current => {
                let next = current;
                for (const change of changes) {
                    if (change.type === 'position' && change.position !== undefined) {
                        const { x, y } = change.position;
                        next = {
                            ...next,
                            nodes: next.nodes.map(node => (node.id === change.id ? { ...node, x: Math.round(x), y: Math.round(y) } : node)),
                        };
                    } else if (change.type === 'remove') {
                        next = {
                            ...next,
                            nodes: next.nodes.filter(node => node.id !== change.id),
                            links: next.links.filter(link => link.from !== change.id && link.to !== change.id),
                        };
                    }
                }
                return next;
            });
        },
        [fitWhenMeasured],
    );

    const onEdgesChange = useCallback((changes: EdgeChange[]) => {
        const removed = new Set(changes.flatMap(change => (change.type === 'remove' ? [change.id] : [])));
        if (removed.size > 0) setFlow(current => ({ ...current, links: current.links.filter(link => !removed.has(edgeId(link))) }));
    }, []);

    /** Like to like, and never into a socket that already has its wire, but a Merge's. */
    const isValidConnection: IsValidConnection = useCallback(
        connection => {
            const from = flow.nodes.find(node => node.id === connection.source);
            const to = flow.nodes.find(node => node.id === connection.target);
            const out = socketOf(connection.sourceHandle);
            const into = socketOf(connection.targetHandle);
            if (from === undefined || to === undefined || out === undefined || into === undefined || from.id === to.id) return false;
            const type = socketsOf(from).outs[out];
            if (type === undefined || type !== socketsOf(to).ins[into]) return false;
            return to.kind === 'merge' || !flow.links.some(link => link.to === to.id && link.in === into);
        },
        [flow.nodes, flow.links],
    );

    /** A new wire replaces whatever left the same output: a record goes one way. */
    const onConnect = useCallback((connection: Connection) => {
        const out = socketOf(connection.sourceHandle);
        const into = socketOf(connection.targetHandle);
        if (out === undefined || into === undefined) return;
        const link: MixLink = { from: connection.source, out, to: connection.target, in: into };
        setFlow(current => ({
            ...current,
            links: [...current.links.filter(existing => !(existing.from === link.from && existing.out === link.out)), link],
        }));
    }, []);

    // Where a rule is about to be added, and the loose end of the wire it is being added at, if any.
    const [adding, setAdding] = useState<Adding | undefined>();
    const addAtCentre = () => setAdding({ at: screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) });

    /** A wire dropped on empty canvas: offer the rules that can take it, where it was dropped. */
    const onConnectEnd: OnConnectEnd = useCallback(
        (event, connection) => {
            if (connection.isValid === true || connection.fromHandle === null || connection.fromNode === null) return;
            const from = flow.nodes.find(node => node.id === connection.fromNode?.id);
            const socket = socketOf(connection.fromHandle.id);
            if (from === undefined || socket === undefined) return;
            const side = connection.fromHandle.type;
            const type = (side === 'source' ? socketsOf(from).outs : socketsOf(from).ins)[socket];
            if (type === undefined) return;
            const point = 'changedTouches' in event ? event.changedTouches[0] : event;
            if (point === undefined) return;
            setAdding({ at: screenToFlowPosition({ x: point.clientX, y: point.clientY }), end: { side, type, nodeId: from.id, socket } });
        },
        [flow.nodes, screenToFlowPosition],
    );

    /** The rule picked, placed where it was asked for and wired to the loose end it was asked from. */
    const place = (kind: MixKind, socket: number) => {
        const request = adding;
        setAdding(undefined);
        if (request === undefined) return;
        setFlow(current => {
            const node = freshNode(kind, nextId(kind, current.nodes), request.at);
            const end = request.end;
            if (end === undefined) return { ...current, nodes: [...current.nodes, node] };
            const link: MixLink =
                end.side === 'source'
                    ? { from: end.nodeId, out: end.socket, to: node.id, in: socket }
                    : { from: node.id, out: socket, to: end.nodeId, in: end.socket };
            // One wire per output, as a drawn wire replaces whatever left the same one.
            const kept = current.links.filter(existing => !(existing.from === link.from && existing.out === link.out));
            return { ...current, nodes: [...current.nodes, node], links: [...kept, link] };
        });
    };

    return (
        <Stack gap="sm" h="calc(100dvh - 32px)">
            <Group justify="space-between" align="flex-end" wrap="wrap">
                <Stack gap={2}>
                    <Text size="xs" c="dimmed">
                        {title ? t('editor.crumbs', { show: title }) : t('editor.crumbsUnnamed')}
                    </Text>
                    <Title order={2} size="h3">
                        {t('editor.title')}
                    </Title>
                    <Text size="sm" c="dimmed" maw={720}>
                        {t('editor.help')}
                    </Text>
                </Stack>
                <Group gap="xs">
                    <Popover opened={confirming} onChange={setConfirming} position="bottom-end" withArrow>
                        <Popover.Target>
                            <Tooltip label={t('draft.noBrief')} disabled={canDraft} multiline w={260}>
                                <Button
                                    size="xs"
                                    variant="light"
                                    color="grape"
                                    leftSection={<IconSparkles size={14} />}
                                    disabled={!canDraft}
                                    loading={drafting.isPending}
                                    onClick={() => (drawn ? setConfirming(true) : draft({}))}
                                >
                                    {t('draft.button')}
                                </Button>
                            </Tooltip>
                        </Popover.Target>
                        <Popover.Dropdown>
                            <Stack gap="xs" maw={260}>
                                <Text size="sm">{t('draft.replace')}</Text>
                                <Group gap="xs" justify="flex-end">
                                    <Button size="xs" variant="default" onClick={() => setConfirming(false)}>
                                        {t('draft.replaceCancel')}
                                    </Button>
                                    <Button
                                        size="xs"
                                        color="grape"
                                        onClick={() => {
                                            setConfirming(false);
                                            setAnswers({});
                                            draft({});
                                        }}
                                    >
                                        {t('draft.replaceConfirm')}
                                    </Button>
                                </Group>
                            </Stack>
                        </Popover.Dropdown>
                    </Popover>
                    <Tooltip label={t('editor.addHint')} multiline w={240}>
                        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addAtCentre}>
                            {t('editor.add')}
                        </Button>
                    </Tooltip>
                    <Button size="xs" variant="default" onClick={onClose}>
                        {t('editor.cancel')}
                    </Button>
                    <Tooltip label={t('editor.fixFirst')} disabled={problems.length === 0} multiline w={260}>
                        <Button size="xs" disabled={problems.length > 0} onClick={() => onDone(flow)}>
                            {t('editor.done')}
                        </Button>
                    </Tooltip>
                </Group>
            </Group>

            <AddRule
                opened={adding !== undefined}
                end={adding?.end === undefined ? undefined : { side: adding.end.side, type: adding.end.type }}
                onPick={place}
                onClose={() => setAdding(undefined)}
            />

            {drafting.isError ? <ErrorAlert title={t('draft.failed')} error={drafting.error} onDismiss={() => drafting.reset()} /> : undefined}

            <Group gap="sm" align="stretch" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
                <div className={classes.canvas} style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
                    <ReactFlow<MixFlowNode>
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={NODE_TYPES}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onConnectEnd={onConnectEnd}
                        // A double-click on the canvas adds a rule there rather than zooming in.
                        zoomOnDoubleClick={false}
                        onPaneClick={event => {
                            if (event.detail === 2) setAdding({ at: screenToFlowPosition({ x: event.clientX, y: event.clientY }) });
                        }}
                        isValidConnection={isValidConnection}
                        colorMode={theme.scheme}
                        deleteKeyCode={['Backspace', 'Delete']}
                        fitView
                        minZoom={MIN_ZOOM}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background gap={24} />
                        <Controls showInteractive={false} />
                        <MiniMap pannable zoomable ariaLabel={t('editor.minimap')} nodeStrokeWidth={3} />
                    </ReactFlow>
                </div>
                {drafting.isPending || readings !== undefined ? (
                    <MixReadings
                        readings={readings ?? []}
                        pending={drafting.isPending}
                        {...(model === undefined ? {} : { model })}
                        answers={answers}
                        onAnswer={(question, answer) => setAnswers(current => ({ ...current, [question]: answer }))}
                        onPoint={setLit}
                        onRedraft={() => draft(answers)}
                    />
                ) : undefined}
            </Group>

            <Group gap="lg" align="flex-start" wrap="wrap" className={classes.status} role="status">
                <Stack gap={4}>
                    <Group gap="xs">
                        <Text size="xs" fw={600}>
                            {t('editor.problemsTitle')}
                        </Text>
                        <Badge size="xs" variant="light" color={problems.length === 0 ? 'teal' : 'red'}>
                            {problems.length}
                        </Badge>
                        <Text size="xs" c="dimmed" className="da-num">
                            {t('editor.status', { nodes: flow.nodes.length, wires: flow.links.length })}
                        </Text>
                    </Group>
                    {problems.length === 0 ? (
                        <Text size="xs" c="dimmed">
                            {t('editor.noProblems')}
                        </Text>
                    ) : (
                        <List size="xs" c="red">
                            {problems.map((problem, index) => (
                                <List.Item key={index}>{problemText(t, problem, flow.nodes)}</List.Item>
                            ))}
                        </List>
                    )}
                </Stack>
                <Stack gap={4} maw={420}>
                    <WireLegend />
                    <Text size="xs" c="dimmed">
                        {t('editor.budget')}
                    </Text>
                </Stack>
            </Group>
        </Stack>
    );
}

/** Where a rule is being added, in the canvas's own coordinates, and the loose wire end it is joining. */
interface Adding {
    at: { x: number; y: number };
    end?: { side: 'source' | 'target'; type: SocketType; nodeId: string; socket: number };
}

/** Records, the ordinary wire, as React Flow draws it from `--xy-edge-stroke`. */
const RECORDS_WIRE = { stroke: 'var(--da-phosphor)' };

/** A number wired from a Time switch into a limit. */
const NUMBER_WIRE = { stroke: 'var(--mantine-color-orange-6)', strokeDasharray: '7 4' };

/** What each limit has left, which the station tells the model: drawn, never stored. */
const BUDGET_WIRE = { stroke: 'var(--mantine-color-grape-5)', strokeDasharray: '1 5', strokeLinecap: 'round', strokeWidth: 2, opacity: 0.7 } as const;

/** The three kinds of wire, as a key under the canvas. */
function WireLegend() {
    const { t } = useTranslation('mix');
    return (
        <Group gap="md" aria-hidden>
            {[
                { label: t('editor.legend.records'), style: RECORDS_WIRE },
                { label: t('editor.legend.number'), style: NUMBER_WIRE },
                { label: t('editor.legend.told'), style: BUDGET_WIRE },
            ].map(({ label, style }) => (
                <Group key={label} gap={6} wrap="nowrap">
                    <svg width={28} height={8} aria-hidden>
                        <line x1={1} y1={4} x2={27} y2={4} strokeWidth={2} {...style} />
                    </svg>
                    <Text size="xs" c="dimmed">
                        {label}
                    </Text>
                </Group>
            ))}
        </Group>
    );
}

function problemText(t: ReturnType<typeof useTranslation<'mix'>>['t'], problem: FlowProblem, nodes: readonly MixNode[]): string {
    const node = nodes.find(candidate => candidate.id === problem.nodeId);
    const name = node === undefined ? '' : `${t(`kinds.${node.kind}`)} (${node.id})`;
    return t(`problems.${problem.kind}`, { node: name });
}
