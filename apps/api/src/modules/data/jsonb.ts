/**
 * A value on its way into a `jsonb` column.
 *
 * kysely-codegen types those columns as `Json`, which is the shape that comes
 * BACK. What goes in is a string: the driver hands the parameter to Postgres as
 * text and the column's own type parses it. So every insert into one has to
 * serialize and then lie to the compiler about having done so, which was written
 * out nine times here — five as a named helper (three of them identical, two as a
 * private method) and four inline.
 *
 * `undefined` becomes SQL `NULL` rather than being serialized, because
 * `JSON.stringify(undefined)` is `undefined` rather than a string, and a
 * parameter of that shape reaches the column as neither valid JSON nor a null.
 * Two of the five copies were missing this guard; neither passes `undefined`
 * today, which is why nothing had gone wrong yet.
 *
 * The return type is `never` so the value is assignable wherever it is needed:
 * the generated types spell these columns several ways depending on whether the
 * column is nullable, and `never` is the one thing that satisfies all of them.
 * That is the same cast the nine call sites were already making by hand.
 */
export const toJsonb = (value: unknown): never => (value === undefined ? null : JSON.stringify(value)) as unknown as never;
