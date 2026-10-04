---
title: 'StationModel'
sidebar_position: 13
mdx:
    format: 'md'
---

> The model slot and its queue

<details>
<summary>Attributes (2)</summary>

| Attribute | Type                 | Required | Description                                               |
| --------- | -------------------- | -------- | --------------------------------------------------------- |
| `waiting` | `number`             | Yes      | Callers queued behind whoever holds the slot. _read-only_ |
| `holder`  | `StationModelHolder` | No       | Absent while the model is free. _read-only_               |

</details>
