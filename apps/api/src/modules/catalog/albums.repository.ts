import { Injectable } from 'injectkit';
import { RepositoryPagination } from '../data/repository.types.js';
import { DataRepository } from '../data/data.repository.js';

@Injectable()
export class AlbumsRepository extends DataRepository {
    async listAlbums(query: RepositoryPagination) {
        const { limit, offset, sort } = query;
        const { total } = await this.db
            .selectFrom('deadair.albums')
            .select(eb => eb.fn.countAll<number>().as('total'))
            .executeTakeFirstOrThrow();
        const data = await this.db.selectFrom('deadair.albums').orderBy('deadair.albums.createdAt', sort).limit(limit).offset(offset).execute();
        return { total: Number(total), data };
    }
}
