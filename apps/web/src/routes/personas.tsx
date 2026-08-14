import { createFileRoute } from '@tanstack/react-router';

import { PersonasPage } from '../components/personas/personas.page';

export const Route = createFileRoute('/personas')({ component: PersonasPage });
