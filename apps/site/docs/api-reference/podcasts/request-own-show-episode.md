---
title: 'Request own show episode'
sidebar_label: 'Request own show episode'
sidebar_position: 11
mdx:
    format: 'md'
---

Asks the show for an episode. It is queued, not started, and airs when it is made or at the time given

**`POST`** `/podcasts/own/{id}/episodes`

:::note
SDK method: `requestOwnShowEpisode`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [OwnEpisodeRequest](../models/podcasts/own-episode-request.md) object.

## Response

`201 Created` — Returns a [Production](../models/productions/production.md) object.
