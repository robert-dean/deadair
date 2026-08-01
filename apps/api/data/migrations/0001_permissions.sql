-- migrate:up

-- =============================================================================
-- relation_tuples — Zanzibar-style tuple store. One row per stored relation.
--
-- The "real" identity of a tuple is the (object, relation, subject) shape; the
-- surrogate uuid `id` exists so audit.enable_full_audit (which casts the first
-- PK column to uuid for audit.logged_actions.row_id and adds a sys_period
-- column for versioning) works without modification.
--
-- Subject encoding:
--   concrete: subject_id = '<uuid-or-id>',  subject_relation = ''
--   wildcard: subject_id = '*',             subject_relation = ''
--   userset:  subject_id = '<id>',          subject_relation = '<relation>'
-- =============================================================================

create table deadair.permissions_relation_tuples (
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now() check (updated_at >= created_at),
    id                uuid primary key default gen_random_uuid(),
    created_by        uuid,

    object_namespace  text not null,
    object_id         text not null,
    relation          text not null,

    subject_namespace text not null,
    subject_id        text not null,
    subject_relation  text not null default '',

    constraint permissions_relation_tuples_object_namespace_chk
        check (object_namespace ~ '^[a-z][a-z0-9_]*$'),
    constraint permissions_relation_tuples_relation_chk
        check (relation ~ '^[a-z][a-z0-9_]*$'),
    constraint permissions_relation_tuples_subject_namespace_chk
        check (subject_namespace ~ '^[a-z][a-z0-9_]*$'),

    constraint permissions_relation_tuples_shape_uniq
        unique (object_namespace, object_id, relation,
                subject_namespace, subject_id, subject_relation)
);

select deadair.add_updated_at_trigger('deadair.permissions_relation_tuples');

-- Forward lookup: "who has relation R on object O?" — used by Check.
create index permissions_relation_tuples_by_object_idx
    on deadair.permissions_relation_tuples (object_namespace, object_id, relation);

-- Reverse lookup: "what objects does this subject touch?" — used by Lookup/BatchCheck.
create index permissions_relation_tuples_by_subject_idx
    on deadair.permissions_relation_tuples
       (subject_namespace, subject_id, subject_relation, object_namespace, relation);

-- migrate:down


drop table if exists deadair.permissions_relation_tuples;

