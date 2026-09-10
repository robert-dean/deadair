---
title: 'TrackStateCounts'
sidebar_position: 17
mdx:
    format: 'md'
---

> How much of the library is in each state, over the whole filtered set rather than this page.
>
> The aggregate is what an operator reads first — "13 of 581 measured" is the sentence that made
> `docs/todo/analysis-queue-ordering.md` necessary, and it was a psql query then. `total` is the
> same number as `meta.total` when nothing is filtered, and is repeated here so the counts can be
> read as N of M without reaching into the pager.

<details>
<summary>Attributes (6)</summary>

| Attribute  | Type     | Required | Description |
| ---------- | -------- | -------- | ----------- |
| `total`    | `number` | Yes      | _read-only_ |
| `cached`   | `number` | Yes      | _read-only_ |
| `measured` | `number` | Yes      | _read-only_ |
| `enriched` | `number` | Yes      | _read-only_ |
| `benched`  | `number` | Yes      | _read-only_ |
| `failing`  | `number` | Yes      | _read-only_ |

</details>
