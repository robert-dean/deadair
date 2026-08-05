import { Injectable } from 'injectkit';
import { RepositoryPagination } from '../data/repository.types.js';
import { DataRepository } from '../data/data.repository.js';

@Injectable()
export class ArtistsRepository extends DataRepository {
    async listArtists(query: RepositoryPagination) {
        const { limit, offset, sort } = query;
        const { total } = await this.db
            .selectFrom('deadair.artists')
            .select(eb => eb.fn.countAll<number>().as('total'))
            .executeTakeFirstOrThrow();
        const data = await this.db.selectFrom('deadair.artists').orderBy('deadair.artists.createdAt', sort).limit(limit).offset(offset).execute();
        return { total: Number(total), data };
    }
}
