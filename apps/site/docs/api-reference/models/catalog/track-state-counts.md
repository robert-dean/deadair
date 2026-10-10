---
title: 'TrackStateCounts'
sidebar_position: 23
mdx:
    format: 'md'
---

> How much of the library is in each state, over the whole filtered set rather than this page.
>
> The aggregate is what an operator reads first — "13 of 581 measured" is the sentence that made
> [analysis-queue-ordering](https://github.com/robert-dean/deadair/discussions/5) necessary, and it was a psql query then. `total` is the
> same number as `meta.total` when nothing is filtered, and is repeated here so the counts can be
> read as N of M without reaching into the pager.

<details>
<summary>Attributes (10)</summary>

| Attribute      | Type     | Required | Description                                                                                  |
| -------------- | -------- | -------- | -------------------------------------------------------------------------------------------- |
| `total`        | `number` | Yes      | _read-only_                                                                                  |
| `cached`       | `number` | Yes      | _read-only_                                                                                  |
| `measured`     | `number` | Yes      | _read-only_                                                                                  |
| `enriched`     | `number` | Yes      | _read-only_                                                                                  |
| `benched`      | `number` | Yes      | _read-only_                                                                                  |
| `failing`      | `number` | Yes      | _read-only_                                                                                  |
| `lyrics`       | `number` | Yes      | A lyrics source has the words of it. The words themselves are never served. _read-only_      |
| `synced`       | `number` | Yes      | A lyrics source has the timing of its lines, which says when the singing starts. _read-only_ |
| `instrumental` | `number` | Yes      | A lyrics source says nobody sings on it. _read-only_                                         |
| `moods`        | `number` | Yes      | A model has judged what mood it is in. _read-only_                                           |

</details>
