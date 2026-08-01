import { Anchor, AppShell, Group, Text } from '@mantine/core';
import { createRootRoute, Link, Outlet } from '@tanstack/react-router';

function RootLayout() {
    return (
        <AppShell header={{ height: 56 }} padding="lg">
            <AppShell.Header>
                <Group h="100%" px="lg" justify="space-between">
                    <Text fw={700} tt="uppercase" style={{ letterSpacing: '0.12em' }}>
                        deadair
                    </Text>
                    <Group gap="lg">
                        <Anchor component={Link} to="/" size="sm">
                            Home
                        </Anchor>
                        <Anchor component={Link} to="/about" size="sm">
                            About
                        </Anchor>
                    </Group>
                </Group>
            </AppShell.Header>
            <AppShell.Main>
                <Outlet />
            </AppShell.Main>
        </AppShell>
    );
}

export const Route = createRootRoute({ component: RootLayout });
