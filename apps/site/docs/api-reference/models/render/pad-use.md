---
title: 'PadUse'
sidebar_position: 28
mdx:
    format: 'md'
---

> Where and when a pad may be hit, written together because the console edits them together

<details>
<summary>Attributes (2)</summary>

| Attribute    | Type             | Required | Description                                                                                       |
| ------------ | ---------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `placements` | `PadPlacement[]` | Yes      | At least one: a sound that may go nowhere is a sound turned down, which is what `PadState` is for |
| `cue`        | `string`         | No       | Absent clears it, so the pad is fair game wherever its placements allow                           |

</details>
