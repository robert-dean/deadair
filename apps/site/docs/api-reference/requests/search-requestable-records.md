---
title: 'Search requestable records'
sidebar_label: 'Search requestable records'
sidebar_position: 1
mdx:
    format: 'md'
---

Records the station could be asked to play, matching a title or an artist

**`GET`** `/requests/search`

:::note
SDK method: `searchRequestableRecords`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description |
| --------- | -------- | -------- | ----------- |
| `q`       | `string` | Yes      |             |
| `limit`   | `number` | No       |             |

</details>

## Response

`200 OK` — Returns a [RequestableTrackList](../models/requests/requestable-track-list.md) object.
