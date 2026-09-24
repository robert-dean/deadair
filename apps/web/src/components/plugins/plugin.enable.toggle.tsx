import { useState } from 'react';
import { Switch, Text } from '@mantine/core';
import type { PluginSummary } from '@deadair/sdk';

import { useSetPluginEnabled } from '../../api/plugins.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { severityColor } from '../shared/status';
import { PluginTrustDialog } from './plugin.trust.dialog';

export interface PluginEnableToggle {
    /** The switch itself, with the trust dialog it may open mounted beside it. */
    control: React.ReactNode;
    /** Why the last change was refused, ready to draw wherever the surface has room for it. */
    error: React.ReactNode;
}

/**
 * The enable switch for one plugin, shared by its card and its table row.
 *
 * A hook rather than a component because the two surfaces put the switch and its error in
 * different places: a card has room under its badges, and a row has only its own cell. What must
 * NOT differ between them is when the trust dialog is asked, so that lives here once.
 */
export function usePluginEnableToggle(plugin: PluginSummary, options: { label?: boolean } = {}): PluginEnableToggle {
    const setEnabled = useSetPluginEnabled();
    const pending = setEnabled.isPending && setEnabled.variables?.id === plugin.id;
    const [trustDialogOpen, setTrustDialogOpen] = useState(false);
    const showLabel = options.label ?? true;

    const control = (
        <>
            <Switch
                size="sm"
                checked={plugin.enabled}
                disabled={pending}
                label={showLabel ? (plugin.enabled ? 'Enabled' : 'Disabled') : undefined}
                aria-label={`Enable ${plugin.name}`}
                onChange={event => {
                    if (!event.currentTarget.checked) {
                        setEnabled.mutate({ id: plugin.id, enabled: false });
                        return;
                    }

                    // Asked once, on the enable that actually extends the trust. A plugin
                    // the operator has turned on before has already answered this, and
                    // asking again on every toggle says the answer was never recorded.
                    if (plugin.firstEnabledAt === undefined) {
                        setTrustDialogOpen(true);
                        return;
                    }

                    setEnabled.mutate({ id: plugin.id, enabled: true });
                }}
            />
            <PluginTrustDialog
                plugin={plugin}
                opened={trustDialogOpen}
                onCancel={() => setTrustDialogOpen(false)}
                onConfirm={() => {
                    setTrustDialogOpen(false);
                    setEnabled.mutate({ id: plugin.id, enabled: true });
                }}
            />
        </>
    );

    const error =
        setEnabled.error && setEnabled.variables?.id === plugin.id ? (
            <Text size="xs" c={severityColor.failure}>
                {apiErrorMessage(setEnabled.error, 'That change could not be applied.')}
            </Text>
        ) : undefined;

    return { control, error };
}
