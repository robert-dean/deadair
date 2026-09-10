---
title: 'Offer track copies again'
sidebar_label: 'Offer track copies again'
sidebar_position: 15
mdx:
    format: 'md'
---

Put copies a provider refused back on offer, and clear their backoff so they are tried now

**`POST`** `/catalog/tracks/{id}/offer`

:::note
SDK method: `offerTrackCopiesAgain`
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

`200 OK` — Returns a [TrackClearResult](../models/catalog/track-clear-result.md) object.
