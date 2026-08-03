import { createFileRoute } from '@tanstack/react-router';

import { pluginDetailOptions } from '../../../api/plugins.queries';
import { PluginDetailPage } from '../../../components/plugins/plugin.detail.page';

export const Route = createFileRoute('/plugins/$id/')({
    component: PluginDetailRoute,
    loader: ({ context, params }) => context.queryClient.ensureQueryData(pluginDetailOptions(params.id)),
});

function PluginDetailRoute() {
    const { id } = Route.useParams();
    return <PluginDetailPage id={id} />;
}
