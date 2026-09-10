---
title: 'TrackEnrichmentDetail'
sidebar_position: 31
mdx:
    format: 'md'
---

> Every provider's answer, plus the same merge the promotion step used, so the console and the
> canonical columns cannot tell different stories. `sources` is empty on a row the walk has not
> reached yet.
>
> `claims` sits beside them rather than inside `merged`, because a claim is the host's own and not
> any provider's. The articles they were read out of are deliberately NOT here: raw source prose is
> stored and never sent.

<details>
<summary>Attributes (4)</summary>

| Attribute | Type                      | Required | Description |
| --------- | ------------------------- | -------- | ----------- |
| `trackId` | `string`                  | Yes      | _read-only_ |
| `merged`  | `TrackEnrichmentData`     | Yes      |             |
| `sources` | `TrackEnrichmentSource[]` | Yes      |             |
| `claims`  | `FactClaim[]`             | Yes      |             |

</details>
