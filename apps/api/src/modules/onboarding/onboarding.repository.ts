import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '../data/data.repository.js';

// Serializes the "is this requirement already satisfied?" check against the write
// that satisfies it. Read Committed — the default here — lets two concurrent
// submissions both see an unsatisfied requirement and both act on it, and no row
// exists yet to take a FOR UPDATE lock on, so the guard needs a lock of its own.
const ONBOARDING_LOCK_KEY = 'deadair:onboarding:requirement';

@Injectable()
export class OnboardingRepository extends DataRepository {
    // Takes the onboarding lock for the remainder of the request transaction;
    // released on commit or rollback, so there is nothing to unlock by hand.
    // Callers must take this BEFORE their guard read, or the guard races anyway.
    async lockOnboarding(): Promise<void> {
        await sql`select pg_advisory_xact_lock(hashtext(${ONBOARDING_LOCK_KEY})::bigint)`.execute(this.db);
    }
}
