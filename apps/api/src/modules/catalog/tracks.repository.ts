import { Injectable } from 'injectkit';
import { DataRepository } from '../data/data.repository.js';
import { RepositoryPagination } from '../data/repository.types.js';

@Injectable()
export class TracksRepository extends DataRepository {
    async listTracks(query: RepositoryPagination) {
        const { limit, offset, sort } = query;
        const { total } = await this.db
            .selectFrom('deadair.tracks')
            .select(eb => eb.fn.countAll<number>().as('total'))
            .executeTakeFirstOrThrow();
        const data = await this.db.selectFrom('deadair.tracks').orderBy('deadair.tracks.createdAt', sort).limit(limit).offset(offset).execute();
        return { total: Number(total), data };
    }
}
