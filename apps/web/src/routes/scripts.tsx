import { createFileRoute } from '@tanstack/react-router';

import { ScriptsPage } from '../components/scripts/scripts.page';

export const Route = createFileRoute('/scripts')({ component: ScriptsPage });
