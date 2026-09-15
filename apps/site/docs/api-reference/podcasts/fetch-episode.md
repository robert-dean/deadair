---
title: 'Fetch episode'
sidebar_label: 'Fetch episode'
sidebar_position: 4
mdx:
    format: 'md'
---

Fetches one episode's audio into the station's store now, rather than waiting for its slot to come near

**`POST`** `/podcasts/episodes/{id}/fetch`

:::note
SDK method: `fetchEpisode`
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

`200 OK` — Returns a [StationEpisode](../models/podcasts/station-episode.md) object.
