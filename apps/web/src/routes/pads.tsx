import { createFileRoute } from '@tanstack/react-router';

import { PadsPage } from '../components/pads/pads.page';

export const Route = createFileRoute('/pads')({ component: PadsPage });
