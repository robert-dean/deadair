import { Fragment, useMemo } from 'react';
import { Anchor, Code, List, Stack, Text, Title } from '@mantine/core';

import { parseMarkdown, type Block, type Inline } from './markdown.parse';

/**
 * Markdown, drawn in the console's own type. The subset and the reason there is no HTML path are in
 * `markdown.parse.ts`.
 *
 * Every heading is drawn at the same small size whatever its level, because the text sits inside a
 * card that already has its own title: a `###` from the changelog is a subsection of one release, not
 * a page heading.
 */
export function MarkdownView({ text }: { text: string }) {
    const blocks = useMemo(() => parseMarkdown(text), [text]);
    return <Blocks blocks={blocks} />;
}

function Blocks({ blocks }: { blocks: Block[] }) {
    return (
        <Stack gap="xs">
            {blocks.map((block, index) => (
                <BlockView key={index} block={block} />
            ))}
        </Stack>
    );
}

function BlockView({ block }: { block: Block }) {
    switch (block.kind) {
        case 'heading':
            return (
                <Title order={5} mt="xs">
                    <Spans spans={block.children} />
                </Title>
            );
        case 'paragraph':
            return (
                <Text size="sm">
                    <Spans spans={block.children} />
                </Text>
            );
        case 'list':
            return (
                <List size="sm" spacing="xs" withPadding={false}>
                    {block.items.map((item, index) => (
                        <List.Item key={index}>
                            <Blocks blocks={item} />
                        </List.Item>
                    ))}
                </List>
            );
    }
}

function Spans({ spans }: { spans: Inline[] }) {
    return (
        <>
            {spans.map((span, index) => (
                <Fragment key={index}>{spanView(span)}</Fragment>
            ))}
        </>
    );
}

function spanView(span: Inline) {
    switch (span.kind) {
        case 'text':
            return span.text;
        case 'code':
            return <Code>{span.text}</Code>;
        case 'strong':
            return (
                <strong>
                    <Spans spans={span.children} />
                </strong>
            );
        case 'em':
            return (
                <em>
                    <Spans spans={span.children} />
                </em>
            );
        case 'link':
            return (
                <Anchor href={span.href} target="_blank" rel="noreferrer" inherit>
                    <Spans spans={span.children} />
                </Anchor>
            );
    }
}
