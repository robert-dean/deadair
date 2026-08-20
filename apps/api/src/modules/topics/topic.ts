import type { ConfigField } from '@deadair/plugin-sdk';

/**
 * What a break can be ABOUT, as the station's own vocabulary.
 *
 * A `news` bulletin can be a TECHNOLOGY bulletin; a weather break is about a PLACE. Those are the
 * same shape of thing — a named list an operator manages, that the format clock can point a band at
 * and a writer can be handed — so it is built once, keyed by `segments.kind`, rather than as a news
 * feature that weather then copies. `docs/todo/station-moment.md` is where the second consumer is
 * argued.
 *
 * ## The chassis knows the name and never the meaning
 *
 * A topic's {@link Topic.config} is read only by the code for its own kind. Nothing here classifies
 * a story, resolves a place or decides whether a break may use one, and nothing generic ever reads
 * that field — which is the same rule `break_requests.context` states, for the same reason: a shared
 * schema would be a shape nobody is in a position to define. What this file owns is that a topic has
 * a kind, a key, a label an operator wrote, and an order.
 */

/** One subject an operator has named. */
export interface Topic {
    id: string;
    /** Which sort of break this is a subject for, as `segments.kind` spells it. */
    kind: string;
    /** The slug anything else refers to this by, unique within its kind. */
    key: string;
    /** What a break calls it out loud. Written into a script, so it is the operator's phrasing. */
    label: string;
    /** This kind's own settings for this topic. See the note above: nothing generic reads it. */
    config: Record<string, unknown>;
    /** The operator's own order, for a console drawing a list. No meaning beyond that. */
    position: number;
}

/** A topic as somebody wrote it, before the database gives it an id. */
export type TopicDraft = Omit<Topic, 'id'>;

/**
 * A sort of break declaring that it HAS subjects, and how one is edited.
 *
 * Registered by the module that owns the kind (`news` from `NewsModule`), which is what keeps the
 * chassis free of every kind's vocabulary — and what makes weather one file plus one registration
 * rather than a change here.
 *
 * `fields` are the plugin SDK's `ConfigField`, deliberately: that is the shape the console already
 * renders for both a plugin's settings and the station's, so a new kind's form is a declaration
 * rather than a component. It also means a kind's config is JSON-safe by construction, which it has
 * to be — it is stored in a `jsonb` column.
 */
export interface TopicKind {
    /** The `segments.kind` this describes. */
    kind: string;
    /**
     * What the console should CALL one of these.
     *
     * A news topic is a category and a weather topic is a location, and a page that called both
     * "topics" would be the chassis's own word leaking into the station's language. Singular and
     * plural, because English.
     */
    noun: { one: string; many: string };
    /** One line saying what these are for, under the heading. */
    description: string;
    /** How this kind's `config` is edited. Rendered by the same component a plugin's settings use. */
    fields: ConfigField[];
}
