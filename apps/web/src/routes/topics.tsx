import { createFileRoute } from '@tanstack/react-router';

import { TopicsPage } from '../components/topics/topics.page';

export const Route = createFileRoute('/topics')({ component: TopicsPage });
