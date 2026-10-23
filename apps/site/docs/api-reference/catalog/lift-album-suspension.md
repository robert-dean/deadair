---
title: 'Lift album suspension'
sidebar_label: 'Lift album suspension'
sidebar_position: 28
mdx:
    format: 'md'
---

End a suspension now. Something not suspended is answered as it stands rather than refused

**`DELETE`** `/catalog/albums/{id}/suspension`

:::note
SDK method: `liftAlbumSuspension`
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

`200 OK` — Returns a [Album](../models/catalog/album.md) object.
