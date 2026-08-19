import { createFileRoute } from '@tanstack/react-router';

import { SchedulePage } from '../components/schedule/schedule.page';

export const Route = createFileRoute('/schedule')({ component: SchedulePage });
