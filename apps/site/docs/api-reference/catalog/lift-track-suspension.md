---
title: 'Lift track suspension'
sidebar_label: 'Lift track suspension'
sidebar_position: 30
mdx:
    format: 'md'
---

End a suspension now. Something not suspended is answered as it stands rather than refused

**`DELETE`** `/catalog/tracks/{id}/suspension`

:::note
SDK method: `liftTrackSuspension`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [Track](../models/catalog/track.md) object.
