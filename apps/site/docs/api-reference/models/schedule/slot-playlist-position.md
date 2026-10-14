---
title: 'SlotPlaylistPosition'
sidebar_position: 8
mdx:
    format: 'md'
---

> Where a slot that resumes its playlist will pick it up. Empty when it would start from the top: the slot does not resume, has no playlist, has aired nothing from it yet, or the last record it aired is no longer on it

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                     |
| --------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`   | `string` | No       | The record the slot opens on next time, as the playlist names it. The station's rules still apply when it opens, so one it will not play by then is passed over |
| `artist`  | `string` | No       | Its lead artist                                                                                                                                                 |

</details>
