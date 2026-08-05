// A `TransactionalJob` subclass declares no constructor of its own, so TypeScript
// emits no `design:paramtypes` for it and injectkit has to walk up the prototype
// chain to find some. The `@Injectable()` on the base class is what puts
// `[Container]` there to be found.
//
// That decorator looks decorative and is not: without it every subclass has to
// repeat `{ deps: [Container] }`, and one that forgets constructs with no
// container and dies at its first dequeue — in a background worker, at whatever
// hour its cron fires, not at boot and not in CI. Hence a test on the metadata
// itself rather than on any one job.

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Container } from 'injectkit';

import { TransactionalJob } from '../../../src/modules/jobs/transactional.job.js';
import { CatalogPlaceholderJob } from '../../../src/modules/catalog/ingest/catalog.placeholder.job.js';

describe('TransactionalJob dependency metadata', () => {
    it('carries its own constructor metadata, naming Container', () => {
        expect(Reflect.getMetadata('design:paramtypes', TransactionalJob)).toEqual([Container]);
    });

    it('lets a subclass with no constructor inherit it', () => {
        // What injectkit actually does: no own metadata on the subclass, so it
        // recurses to the base. `getMetadata` (unlike `getOwnMetadata`) walks the
        // chain, which is the same answer from the other direction.
        expect(Reflect.getOwnMetadata('design:paramtypes', CatalogPlaceholderJob)).toBeUndefined();
        expect(Reflect.getMetadata('design:paramtypes', CatalogPlaceholderJob)).toEqual([Container]);
    });

    it('still declares one constructor parameter, so the metadata is required rather than incidental', () => {
        // injectkit only complains when `target.length > 0`. If the base ever
        // stopped taking the container, this whole mechanism would go quiet on
        // its own — and this assertion would be the thing that noticed.
        expect(TransactionalJob.length).toBe(1);
    });
});
