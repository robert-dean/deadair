import type { ComponentType, ReactNode } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Dropzone, type DropzoneProps } from '@mantine/dropzone';
import { IconUpload, IconX } from '@tabler/icons-react';

export interface UploadDropzoneProps extends Omit<DropzoneProps, 'children'> {
    /** What is being asked for, shown until a file is over the zone. */
    icon: ComponentType<{ size?: number }>;
    /** The size of all three icons. A dropzone sitting in a row with something else takes a smaller one. */
    iconSize?: number;
    minHeight?: number;
    /** The line that says what to do. */
    prompt: ReactNode;
    /** The line under it, usually what is accepted and how big. */
    hint?: ReactNode;
}

/**
 * Somewhere to drop a file.
 *
 * The five of these differed in what they ask for and what they do with it, and every other line was
 * the same: an upload arrow while a file that fits is held over the zone, a cross for one that will
 * not, and the page's own icon the rest of the time. So those differences are the props, and whatever
 * else the Mantine component takes (`accept`, `maxSize`, `loading`, `onDrop`, `inputProps`) goes
 * straight through to it. The checks stay a courtesy: the server refuses the same files and says why.
 *
 * `pointerEvents: 'none'` on the content is what lets a click anywhere in the zone reach the input
 * under it. Draws no `Card` of its own; see `apps/web/CLAUDE.md` on wrappers.
 */
export function UploadDropzone({ icon: Icon, iconSize = 32, minHeight = 90, prompt, hint, ...dropzone }: UploadDropzoneProps) {
    return (
        <Dropzone {...dropzone}>
            <Group justify="center" gap="md" mih={minHeight} style={{ pointerEvents: 'none' }}>
                <Dropzone.Accept>
                    <IconUpload size={iconSize} />
                </Dropzone.Accept>
                <Dropzone.Reject>
                    <IconX size={iconSize} />
                </Dropzone.Reject>
                <Dropzone.Idle>
                    <Icon size={iconSize} />
                </Dropzone.Idle>
                {hint === undefined ? (
                    <Text size="sm">{prompt}</Text>
                ) : (
                    <Stack gap={2}>
                        <Text size="sm">{prompt}</Text>
                        <Text size="xs" c="dimmed">
                            {hint}
                        </Text>
                    </Stack>
                )}
            </Group>
        </Dropzone>
    );
}
