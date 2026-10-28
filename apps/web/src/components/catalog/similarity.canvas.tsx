import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Box, Paper, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { useTranslation } from 'react-i18next';

import { boundsOf, nodeAt, type PlacedGraph, type PlacedNode } from './similarity.layout';

export interface SimilarityCanvasProps {
    graph: PlacedGraph;
    /** The artist the drawing is centred on, ringed so it can be found. */
    centreKey?: string;
    /** A catalog artist was clicked. Artists only a source has named have no page, so are not clickable. */
    onOpenArtist: (artistId: string) => void;
    height?: number;
}

interface View {
    scale: number;
    x: number;
    y: number;
}

/** Below this, labels would overlap into a smear, so only the hubs and the hovered neighbourhood are named. */
const LABEL_EVERY_SCALE = 1.6;
/**
 * The most-joined artists are named at any zoom, so the drawing has landmarks before it is explored.
 * A drawing this small or smaller names everybody: there is room, and an unnamed dot among a dozen
 * named ones reads as a mistake.
 */
const LANDMARKS = 24;

/**
 * Who resembles whom, drawn: artists as dots, sized by how joined they are, lit when the catalog
 * holds them.
 *
 * A canvas rather than SVG, because six hundred edges and their nodes as DOM elements is a page that
 * stutters on every pan. The colours are read off the `--da-*` tokens at draw time rather than
 * written here, so the drawing follows whichever of the station's themes is on, and is redrawn when
 * that changes.
 */
export function SimilarityCanvas({ graph, centreKey, onOpenArtist, height = 560 }: SimilarityCanvasProps) {
    const { t } = useTranslation('catalog');
    const { ref: frame, width } = useElementSize();
    const canvas = useRef<HTMLCanvasElement>(null);
    const [hovered, setHovered] = useState<PlacedNode>();
    const [pointer, setPointer] = useState<{ x: number; y: number }>();
    const palette = usePaletteVersion();
    const drag = useRef<{ startX: number; startY: number; viewX: number; viewY: number; moved: boolean }>(undefined);

    const landmarks = useMemo(
        () =>
            new Set(
                [...graph.nodes]
                    .sort((a, b) => b.degree - a.degree)
                    .slice(0, LANDMARKS)
                    .map(node => node.key),
            ),
        [graph],
    );
    const neighbours = useMemo(() => {
        const around = new Map<string, Set<string>>();
        for (const link of graph.links) {
            for (const [a, b] of [
                [link.source.key, link.target.key],
                [link.target.key, link.source.key],
            ] as const) {
                const own = around.get(a);
                if (own === undefined) around.set(a, new Set([b]));
                else own.add(b);
            }
        }
        return around;
    }, [graph]);

    // The whole drawing fitted to the canvas, which is the view until somebody pans or zooms. A view
    // they moved belongs to the drawing and width it was moved on, so a new drawing or a resize
    // starts fitted again rather than somewhere off in the old one's space.
    const fitted = useMemo(() => fitView(graph, width, height), [graph, width, height]);
    const [moved, setMoved] = useState<{ graph: PlacedGraph; width: number; view: View }>();
    const view = moved !== undefined && moved.graph === graph && moved.width === width ? moved.view : fitted;
    const setView = useCallback(
        (update: (previous: View) => View) =>
            setMoved(previous => ({
                graph,
                width,
                view: update(previous !== undefined && previous.graph === graph && previous.width === width ? previous.view : fitted),
            })),
        [graph, width, fitted],
    );
    const [panning, setPanning] = useState(false);

    // The wheel is bound by hand because React's own listener is passive, and a passive one cannot
    // stop the page scrolling under a zoom.
    useEffect(() => {
        const element = canvas.current;
        if (element === null) return;
        const zoom = (event: WheelEvent) => {
            event.preventDefault();
            const rect = element.getBoundingClientRect();
            const px = event.clientX - rect.left;
            const py = event.clientY - rect.top;
            setView(previous => {
                const scale = Math.min(Math.max(previous.scale * Math.exp(-event.deltaY * 0.0015), 0.1), 12);
                const ratio = scale / previous.scale;
                return { scale, x: px - (px - previous.x) * ratio, y: py - (py - previous.y) * ratio };
            });
        };
        element.addEventListener('wheel', zoom, { passive: false });
        return () => element.removeEventListener('wheel', zoom);
    }, [setView]);

    useEffect(() => {
        const element = canvas.current;
        const context = element?.getContext('2d');
        if (element === null || element === undefined || context === null || context === undefined || width === 0) return;

        const ratio = window.devicePixelRatio || 1;
        element.width = width * ratio;
        element.height = height * ratio;
        const colours = readPalette(element);

        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.setTransform(ratio * view.scale, 0, 0, ratio * view.scale, ratio * view.x, ratio * view.y);

        const lit = hovered === undefined ? undefined : new Set([hovered.key, ...(neighbours.get(hovered.key) ?? [])]);

        for (const link of graph.links) {
            const touches = lit !== undefined && (link.source.key === hovered!.key || link.target.key === hovered!.key);
            context.globalAlpha = lit === undefined ? 0.4 + 0.5 * link.weight : touches ? 0.95 : 0.06;
            context.strokeStyle = link.mutual || touches ? colours.accent : colours.edge;
            context.lineWidth = (link.mutual ? 1.6 : 0.8) / view.scale;
            context.beginPath();
            context.moveTo(link.source.x, link.source.y);
            context.lineTo(link.target.x, link.target.y);
            context.stroke();
        }

        for (const node of graph.nodes) {
            context.globalAlpha = lit === undefined || lit.has(node.key) ? 1 : 0.2;
            context.fillStyle = node.artistId === undefined ? colours.stranger : colours.accent;
            context.beginPath();
            context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            context.fill();
            if (node.key === centreKey || node === hovered) {
                context.strokeStyle = colours.text;
                context.lineWidth = 2 / view.scale;
                context.beginPath();
                context.arc(node.x, node.y, node.radius + 3 / view.scale, 0, Math.PI * 2);
                context.stroke();
            }
        }

        context.font = `${12 / view.scale}px ${colours.font}`;
        context.textBaseline = 'middle';
        for (const node of graph.nodes) {
            const named =
                lit !== undefined ? lit.has(node.key) : view.scale >= LABEL_EVERY_SCALE || landmarks.has(node.key) || node.key === centreKey;
            if (!named) continue;
            context.globalAlpha = 1;
            const x = node.x + node.radius + 4 / view.scale;
            // A halo in the panel's colour, so a name stays readable across the lines behind it.
            context.lineWidth = 3 / view.scale;
            context.strokeStyle = colours.panel;
            context.strokeText(node.name, x, node.y);
            context.fillStyle = colours.text;
            context.fillText(node.name, x, node.y);
        }
        context.globalAlpha = 1;
    }, [graph, view, hovered, neighbours, landmarks, centreKey, width, height, palette]);

    const toLayout = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        return { px, py, x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
    };

    return (
        <Box
            ref={frame}
            pos="relative"
            h={height}
            style={{ border: '1px solid var(--da-border)', borderRadius: 'var(--mantine-radius-md)', overflow: 'hidden' }}
        >
            <canvas
                ref={canvas}
                role="img"
                aria-label={t('similarity.canvasLabel', { artists: graph.nodes.length, links: graph.links.length })}
                style={{
                    width: '100%',
                    height,
                    display: 'block',
                    background: 'var(--da-panel)',
                    cursor: panning ? 'grabbing' : hovered?.artistId !== undefined ? 'pointer' : 'grab',
                    touchAction: 'none',
                }}
                onPointerDown={event => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { startX: event.clientX, startY: event.clientY, viewX: view.x, viewY: view.y, moved: false };
                }}
                onPointerMove={event => {
                    const at = toLayout(event);
                    const dragging = drag.current;
                    if (dragging !== undefined) {
                        const dx = event.clientX - dragging.startX;
                        const dy = event.clientY - dragging.startY;
                        if (!dragging.moved && Math.abs(dx) + Math.abs(dy) > 3) {
                            dragging.moved = true;
                            setPanning(true);
                        }
                        if (dragging.moved) {
                            setView(previous => ({ ...previous, x: dragging.viewX + dx, y: dragging.viewY + dy }));
                            return;
                        }
                    }
                    setHovered(nodeAt(graph.nodes, at.x, at.y, 3 / view.scale));
                    setPointer({ x: at.px, y: at.py });
                }}
                onPointerUp={event => {
                    const dragging = drag.current;
                    drag.current = undefined;
                    setPanning(false);
                    if (dragging?.moved) return;
                    const at = toLayout(event);
                    const node = nodeAt(graph.nodes, at.x, at.y, 3 / view.scale);
                    if (node?.artistId !== undefined) onOpenArtist(node.artistId);
                }}
                onPointerLeave={() => {
                    setHovered(undefined);
                    setPointer(undefined);
                }}
            />
            {hovered !== undefined && pointer !== undefined ? (
                <Paper
                    withBorder
                    shadow="sm"
                    p="xs"
                    pos="absolute"
                    style={{
                        left: Math.min(pointer.x + 14, Math.max(width - 240, 0)),
                        top: Math.min(pointer.y + 14, height - 72),
                        pointerEvents: 'none',
                        maxWidth: 240,
                    }}
                >
                    <Text size="sm" fw={600} truncate>
                        {hovered.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {hovered.artistId === undefined ? t('similarity.notInLibrary') : t('similarity.inLibrary')}
                    </Text>
                    <Text size="xs" c="dimmed">
                        {t('similarity.connections', { count: hovered.degree })}
                    </Text>
                </Paper>
            ) : undefined}
        </Box>
    );
}

/**
 * The view that shows the whole drawing, centred, enlarged by half at most: a fifteen-artist graph
 * fitted to the canvas at any zoom turns every dot into a disc.
 */
function fitView(graph: PlacedGraph, width: number, height: number): View {
    if (width === 0) return { scale: 1, x: 0, y: 0 };
    const box = boundsOf(graph.nodes);
    const padding = 24;
    const scale = Math.min((width - padding * 2) / Math.max(box.maxX - box.minX, 1), (height - padding * 2) / Math.max(box.maxY - box.minY, 1), 1.5);
    return { scale, x: width / 2 - ((box.minX + box.maxX) / 2) * scale, y: height / 2 - ((box.minY + box.maxY) / 2) * scale };
}

interface Palette {
    accent: string;
    stranger: string;
    edge: string;
    text: string;
    panel: string;
    font: string;
}

function readPalette(element: HTMLElement): Palette {
    const style = getComputedStyle(element);
    const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return {
        accent: token('--da-series-a', '#0b9459'),
        stranger: token('--da-text-dimmed', '#75817b'),
        edge: token('--da-border-strong', '#313836'),
        text: token('--da-text', '#e8edea'),
        panel: token('--da-panel', '#121514'),
        font: style.fontFamily || 'sans-serif',
    };
}

/**
 * A number that moves whenever the station's theme or colour scheme does.
 *
 * Both are attributes on `<html>` (`data-da-theme`, `data-mantine-color-scheme`), and a canvas is
 * not restyled by CSS the way an element is: it holds the pixels it was given, so it has to be told
 * to draw again in the new colours.
 */
function usePaletteVersion(): number {
    const [version, setVersion] = useState(0);
    useEffect(() => {
        const observer = new MutationObserver(() => setVersion(previous => previous + 1));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-da-theme', 'data-mantine-color-scheme'] });
        return () => observer.disconnect();
    }, []);
    return version;
}
