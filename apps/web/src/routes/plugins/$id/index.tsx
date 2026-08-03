import { createFileRoute } from '@tanstack/react-router';

import { pluginDetailOptions } from '../../../api/plugins.queries';
import { PluginDetailPage } from '../../../components/plugins/plugin.detail.page';

export const Route = createFileRoute('/plugins/$id/')({
    component: PluginDetailRoute,
    // Warms the same cache the page's hook reads from, so the loader and the render are one
    // request rather than two. The rejection is swallowed on purpose: the failure stays in the
    // query cache, where the page's own `plugin.error` branch turns it into a "No plugin with the
    // id ... answered" alert. Propagating it would abandon the navigation to the router's default
    // error component, so a deep link to a plugin that is merely gone would cost the whole screen.
    loader: async ({ context, params }) => {
        await context.queryClient.ensureQueryData(pluginDetailOptions(params.id)).catch(() => undefined);
    },
});

function PluginDetailRoute() {
    const { id } = Route.useParams();
    return <PluginDetailPage id={id} />;
}
