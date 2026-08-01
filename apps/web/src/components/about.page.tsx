import { Stack, Text, Title } from '@mantine/core';

export function AboutPage() {
    return (
        <Stack gap="md">
            <Title order={1}>About</Title>
            <Text c="dimmed" maw={560}>
                Placeholder route, here to prove file-based routing and navigation work.
            </Text>
        </Stack>
    );
}
