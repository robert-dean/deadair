---
title: 'AttentionEvidence'
sidebar_position: 7
mdx:
    format: 'md'
---

> One concrete thing an attention row is about, so the reason does not live a page away.
>
> The row above it counts and categorises; this names. "4 records have no copy left that will play"
> is a category an operator can do nothing with until they know WHICH four and WHY each one, and
> every one of those facts was already stored — the fetch error on `track_audio.last_error`, the
> provider's refusal on `track_sources.playable` — and reachable only by finding the record and
> hovering a cell on its page. This is that fact travelling with the row that counted it.

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                                                                                            |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `label`   | `string` | Yes      | The thing itself, as an operator would name it: a record's title and who made it                                                                       |
| `reason`  | `string` | Yes      | Why THIS one, in the station's own sentence. The row's `detail` says what the category means; this says what happened here                             |
| `route`   | `string` | No       | The page holding the whole of it. Absent where there is no page for it, which the running order can hold: a record the catalog never ingested has none |

</details>
