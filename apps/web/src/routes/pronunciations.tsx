import { createFileRoute } from '@tanstack/react-router';

import { PronunciationsPage } from '../components/pronunciations/pronunciations.page';

export const Route = createFileRoute('/pronunciations')({ component: PronunciationsPage });
