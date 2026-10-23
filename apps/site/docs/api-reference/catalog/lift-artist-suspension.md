---
title: 'Lift artist suspension'
sidebar_label: 'Lift artist suspension'
sidebar_position: 26
mdx:
    format: 'md'
---

End a suspension now. Something not suspended is answered as it stands rather than refused

**`DELETE`** `/catalog/artists/{id}/suspension`

:::note
SDK method: `liftArtistSuspension`
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

`200 OK` — Returns a [Artist](../models/catalog/artist.md) object.
