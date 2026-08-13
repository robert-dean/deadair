import { createFileRoute } from '@tanstack/react-router';

import { ActivityPage } from '../components/activity/activity.page';

export const Route = createFileRoute('/activity')({ component: ActivityPage });
