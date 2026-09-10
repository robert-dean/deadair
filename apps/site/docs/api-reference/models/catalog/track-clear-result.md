---
title: 'TrackClearResult'
sidebar_position: 10
mdx:
    format: 'md'
---

> What a clear actually did.
>
> A count rather than a bare 204, because the interesting answers are the small ones: clearing the
> audio of a record with three copies and being told `1` is the station saying two of them were
> never here — which is a fact about the record and not about the button.

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                |
| --------- | -------- | -------- | -------------------------------------------------------------------------- |
| `trackId` | `string` | Yes      | _read-only_                                                                |
| `cleared` | `number` | Yes      | Rows this affected. Zero is an ordinary answer, not a failure. _read-only_ |
| `detail`  | `string` | Yes      | What happened, in the words the console shows. _read-only_                 |

</details>
