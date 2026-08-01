import { Badge, Group, Stack, Text, Title } from '@mantine/core';

export function HomePage() {
    return (
        <Stack gap="md">
            <Group gap="sm">
                <Title order={1}>deadair</Title>
                <Badge variant="light">off air</Badge>
            </Group>
            <Text c="dimmed" maw={560}>
                A self-driving internet radio station. The console is not wired up yet.
            </Text>
        </Stack>
    );
}
