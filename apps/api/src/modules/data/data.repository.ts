import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { DB } from './db.js';

export * from './db.js';

@Injectable()
export abstract class DataRepository {
    constructor(protected readonly db: Kysely<DB>) {}
}
