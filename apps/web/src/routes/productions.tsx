import { createFileRoute } from '@tanstack/react-router';

import { ProductionsPage } from '../components/productions/productions.page';

export const Route = createFileRoute('/productions')({ component: ProductionsPage });
