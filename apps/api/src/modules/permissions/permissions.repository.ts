import { Injectable } from 'injectkit';
import { OnPostgresError } from '@maroonedsoftware/errors';
import { OnKyselyError } from '@maroonedsoftware/kysely';
import { ObjectRef, PermissionsTupleRepository, RelationTuple, SubjectRef } from '@maroonedsoftware/permissions';
import { DataRepository } from '#modules/data/data.repository.js';

type TupleRow = {
    objectNamespace: string;
    objectId: string;
    relation: string;
    subjectNamespace: string;
    subjectId: string;
    subjectRelation: string;
};

const tupleToRow = (t: RelationTuple): TupleRow => {
    const s = t.subject;
    return {
        objectNamespace: t.object.namespace,
        objectId: t.object.id,
        relation: t.relation,
        subjectNamespace: s.namespace,
        subjectId: s.kind === 'wildcard' ? '*' : s.id,
        subjectRelation: s.kind === 'userset' ? s.relation : '',
    };
};

const rowToTuple = (r: TupleRow): RelationTuple => {
    const subject: SubjectRef =
        r.subjectId === '*'
            ? { kind: 'wildcard', namespace: r.subjectNamespace }
            : r.subjectRelation !== ''
              ? { kind: 'userset', namespace: r.subjectNamespace, id: r.subjectId, relation: r.subjectRelation }
              : { kind: 'concrete', namespace: r.subjectNamespace, id: r.subjectId };
    return {
        object: { namespace: r.objectNamespace, id: r.objectId },
        relation: r.relation,
        subject,
    };
};

// Exported so unit tests can round-trip without the repository.
export const __testing = { tupleToRow, rowToTuple };

@Injectable()
@OnPostgresError()
@OnKyselyError()
export class DeadairPermissionsTupleRepository extends DataRepository implements PermissionsTupleRepository {
    async write(tuples: RelationTuple[], createdBy?: string): Promise<void> {
        if (tuples.length === 0) return;
        const rows = tuples.map(t => ({ ...tupleToRow(t), createdBy: createdBy ?? null }));
        await this.db
            .insertInto('deadair.permissionsRelationTuples')
            .values(rows)
            .onConflict(oc => oc.doNothing())
            .execute();
    }

    async delete(tuples: RelationTuple[]): Promise<void> {
        if (tuples.length === 0) return;
        for (const t of tuples) {
            const row = tupleToRow(t);
            await this.db
                .deleteFrom('deadair.permissionsRelationTuples')
                .where('objectNamespace', '=', row.objectNamespace)
                .where('objectId', '=', row.objectId)
                .where('relation', '=', row.relation)
                .where('subjectNamespace', '=', row.subjectNamespace)
                .where('subjectId', '=', row.subjectId)
                .where('subjectRelation', '=', row.subjectRelation)
                .execute();
        }
    }

    async listByObjectRelation(namespace: string, objectId: string, relation: string): Promise<RelationTuple[]> {
        const rows = await this.db
            .selectFrom('deadair.permissionsRelationTuples')
            .where('objectNamespace', '=', namespace)
            .where('objectId', '=', objectId)
            .where('relation', '=', relation)
            .select(['objectNamespace', 'objectId', 'relation', 'subjectNamespace', 'subjectId', 'subjectRelation'])
            .execute();
        return rows.map(rowToTuple);
    }

    async listObjectsRelatedBy(namespace: string, objectId: string, relation: string): Promise<Array<{ namespace: string; id: string }>> {
        const tuples = await this.listByObjectRelation(namespace, objectId, relation);
        const parents: Array<{ namespace: string; id: string }> = [];
        for (const t of tuples) {
            if (t.subject.kind === 'concrete') {
                parents.push({ namespace: t.subject.namespace, id: t.subject.id });
            }
        }
        return parents;
    }

    // Reverse of listByObjectRelation: given a (relation, subject), return the
    // object IDs in `namespace` that hold a tuple to that subject. Concrete
    // subject inputs additionally pull in any wildcard tuples of the matching
    // subject namespace, since wildcards grant any concrete subject of that
    // namespace. Backed by relation_tuples_by_subject_idx.
    async listObjectsForSubject(namespace: string, relation: string, subject: SubjectRef): Promise<{ id: string }[]> {
        const subjectRelation = subject.kind === 'userset' ? subject.relation : '';
        let q = this.db
            .selectFrom('deadair.permissionsRelationTuples')
            .where('objectNamespace', '=', namespace)
            .where('relation', '=', relation)
            .where('subjectNamespace', '=', subject.namespace)
            .where('subjectRelation', '=', subjectRelation);
        if (subject.kind === 'concrete') {
            // Match either the exact concrete subject or a wildcard of the same ns.
            q = q.where(eb => eb.or([eb('subjectId', '=', subject.id), eb('subjectId', '=', '*')]));
        } else if (subject.kind === 'wildcard') {
            q = q.where('subjectId', '=', '*');
        } else {
            q = q.where('subjectId', '=', subject.id);
        }
        const rows = await q.select(['objectId']).distinct().execute();
        return rows.map(r => ({ id: r.objectId }));
    }

    // Returns the relations on `object` for which `subject` has a stored tuple.
    // Used to enumerate a user's platform roles in one query — far cheaper than
    // probing each candidate relation with checkSubject.
    async listRelationsForSubjectOnObject(object: ObjectRef, subject: SubjectRef): Promise<string[]> {
        const subjectRelation = subject.kind === 'userset' ? subject.relation : '';
        let q = this.db
            .selectFrom('deadair.permissionsRelationTuples')
            .where('objectNamespace', '=', object.namespace)
            .where('objectId', '=', object.id)
            .where('subjectNamespace', '=', subject.namespace)
            .where('subjectRelation', '=', subjectRelation);
        if (subject.kind === 'concrete') {
            q = q.where(eb => eb.or([eb('subjectId', '=', subject.id), eb('subjectId', '=', '*')]));
        } else if (subject.kind === 'wildcard') {
            q = q.where('subjectId', '=', '*');
        } else {
            q = q.where('subjectId', '=', subject.id);
        }
        const rows = await q.select('relation').distinct().execute();
        return rows.map(r => r.relation);
    }

    // Returns child object IDs in `childNamespace` whose `relation` references
    // the given parent (concrete object subject). Powers reverse tupleToUserset
    // walks. Backed by relation_tuples_by_subject_idx.
    async listChildrenByParent(childNamespace: string, relation: string, parent: ObjectRef): Promise<{ id: string }[]> {
        const rows = await this.db
            .selectFrom('deadair.permissionsRelationTuples')
            .where('objectNamespace', '=', childNamespace)
            .where('relation', '=', relation)
            .where('subjectNamespace', '=', parent.namespace)
            .where('subjectId', '=', parent.id)
            .where('subjectRelation', '=', '')
            .select(['objectId'])
            .distinct()
            .execute();
        return rows.map(r => ({ id: r.objectId }));
    }
}
