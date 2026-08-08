import { createFileRoute } from '@tanstack/react-router';

import { VoicesPage } from '../components/voices/voices.page';

export const Route = createFileRoute('/voices')({ component: VoicesPage });
