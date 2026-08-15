import { Stack, Text } from '@mantine/core';

import { PageHeader } from './shared/page.header';

export function AboutPage() {
    return (
        <Stack gap="md">
            <PageHeader
                title="About"
                description={
                    <Text c="dimmed" maw={560}>
                        Placeholder route, here to prove file-based routing and navigation work.
                    </Text>
                }
            />
        </Stack>
    );
}
