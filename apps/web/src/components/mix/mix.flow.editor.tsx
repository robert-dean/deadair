import { useCallback, useMemo, useState } from 'react';
import { Button, Group, List, Menu, Modal, Stack, Text } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import {
    Background,
    Controls,
    MarkerType,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Connection,
    type Edge,
    type EdgeChange,
    type IsValidConnection,
    type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MixFlow, MixLink, MixNode } from '@deadair/sdk';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme.store';
import { flowProblems, freshNode, nextId, PALETTE_KINDS, relinkSplit, socketsOf, starterFlow, type FlowProblem } from './mix.kinds';
import { MixNodeView, type MixFlowNode } from './mix.node';
import classes from './mix.flow.module.css';

const NODE_TYPES = { mix: MixNodeView };

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
export function MixFlowEditor({ opened, flow, title, onDone, onClose }: Props) {
    const { t } = useTranslation('mix');
    return (
        <Modal
            opened={opened}
            onClose={onClose}
            fullScreen
            title={title ? t('editor.titleNamed', { show: title }) : t('editor.title')}
            closeOnEscape={false}
        >
            {opened ? (
                <ReactFlowProvider>
                    <Canvas initial={flow ?? starterFlow()} onDone={onDone} onClose={onClose} />
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
    onDone: (flow: MixFlow) => void;
    onClose: () => void;
}

function Canvas({ initial, onDone, onClose }: { initial: MixFlow; onDone: (flow: MixFlow) => void; onClose: () => void }) {
    const { t } = useTranslation('mix');
    const theme = useTheme();
    const { screenToFlowPosition } = useReactFlow();
    const [flow, setFlow] = useState<MixFlow>(initial);
    const problems = useMemo(() => flowProblems(flow), [flow]);

    const changeNode = useCallback((next: MixNode, relink?: { removed: number } | { addedAt: number }) => {
        setFlow(current => ({
            ...current,
            nodes: current.nodes.map(node => (node.id === next.id ? next : node)),
            links: relink === undefined ? current.links : relinkSplit(current.links, next.id, relink),
        }));
    }, []);

    const nodes: MixFlowNode[] = useMemo(
        () =>
            flow.nodes.map(node => ({
                id: node.id,
                type: 'mix' as const,
                position: { x: node.x ?? 0, y: node.y ?? 0 },
                // Picks and On air are what every flow is; removing either leaves nothing that can run.
                deletable: node.kind !== 'picks' && node.kind !== 'onAir',
                data: { node, problems: problems.filter(problem => problem.nodeId === node.id), onChange: changeNode },
            })),
        [flow.nodes, problems, changeNode],
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
                ...(number ? { style: { stroke: 'var(--mantine-color-orange-6)' } } : {}),
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
                          style: { stroke: 'var(--mantine-color-grape-5)', strokeDasharray: '6 5', opacity: 0.6 },
                      }));
        return [...wires, ...budget];
    }, [flow.links, flow.nodes]);

    const onNodesChange = useCallback((changes: NodeChange<MixFlowNode>[]) => {
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
    }, []);

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

    const add = (kind: (typeof PALETTE_KINDS)[number]) => {
        const centre = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        setFlow(current => ({ ...current, nodes: [...current.nodes, freshNode(kind, nextId(kind, current.nodes), centre)] }));
    };

    return (
        <Stack gap="sm" h="calc(100dvh - 90px)">
            <Group justify="space-between" wrap="wrap">
                <Text size="sm" c="dimmed" maw={720}>
                    {t('editor.help')}
                </Text>
                <Group gap="xs">
                    <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />}>
                                {t('editor.add')}
                            </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                            {PALETTE_KINDS.map(kind => (
                                <Menu.Item key={kind} onClick={() => add(kind)}>
                                    <Text size="sm">{t(`kinds.${kind}`)}</Text>
                                    <Text size="xs" c="dimmed">
                                        {t(`hints.${kind}`)}
                                    </Text>
                                </Menu.Item>
                            ))}
                        </Menu.Dropdown>
                    </Menu>
                    <Button size="xs" variant="default" onClick={onClose}>
                        {t('editor.cancel')}
                    </Button>
                    <Button size="xs" onClick={() => onDone(flow)}>
                        {t('editor.done')}
                    </Button>
                </Group>
            </Group>

            <div className={classes.canvas} style={{ flex: 1, minHeight: 0 }}>
                <ReactFlow<MixFlowNode>
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={NODE_TYPES}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    isValidConnection={isValidConnection}
                    colorMode={theme.scheme}
                    deleteKeyCode={['Backspace', 'Delete']}
                    fitView
                    proOptions={{ hideAttribution: true }}
                >
                    <Background gap={24} />
                    <Controls showInteractive={false} />
                </ReactFlow>
            </div>

            <Group gap="lg" align="flex-start" wrap="wrap">
                <Stack gap={4}>
                    <Text size="xs" fw={600}>
                        {t('editor.problemsTitle')}
                    </Text>
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
                <Text size="xs" c="dimmed" maw={420}>
                    {t('editor.budget')}
                </Text>
            </Group>
        </Stack>
    );
}

function problemText(t: ReturnType<typeof useTranslation<'mix'>>['t'], problem: FlowProblem, nodes: readonly MixNode[]): string {
    const node = nodes.find(candidate => candidate.id === problem.nodeId);
    const name = node === undefined ? '' : `${t(`kinds.${node.kind}`)} (${node.id})`;
    return t(`problems.${problem.kind}`, { node: name });
}
