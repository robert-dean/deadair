---
title: 'StationModelHolder'
sidebar_position: 12
mdx:
    format: 'md'
---

> Who has the station's one model slot, and how many are waiting for it.
>
> The model is shared by every break, every programme refill and every production, one generation at
> a time, so a slot held for far longer than any generation takes is the station's ability to speak
> stuck behind one answer. Nothing else exposes it.

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type                                               | Required | Description                                                                                                                                                    |
| ----------- | -------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `priority`  | `'breaking' \| 'air' \| 'background' \| 'preview'` | Yes      | Whose work it is: `breaking` and `air` have a deadline, `background` (a refill, a production) does not, `preview` is an operator trying something. _read-only_ |
| `heldSince` | `string`                                           | Yes      | When it took the slot. Every generation is bounded at ten minutes, so a holder older than that is a stream that stopped arriving. _read-only_                  |
| `plugin`    | `string`                                           | No       | The model plugin answering it. _read-only_                                                                                                                     |

</details>
