---
title: 'Skip the current item'
sidebar_label: 'Skip the current item'
sidebar_position: 6
mdx:
    format: 'md'
---

Ends the item on air so the next one starts immediately. The station owns the decoder, so this lands at once rather than waiting out audio already committed to a player

**`POST`** `/playout/skip`

:::note
SDK method: `skipTheCurrentItem`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                                                                                                                             |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item`    | `string` | No       | The id of the item on air as the caller last saw it (`PlayoutStatus.nowPlaying.item.id`). When it is no longer on air the skip is refused with a 409 and nothing is cut, so a press meant for a record that has just ended never takes off the one after it. Left out, the skip cuts whatever is on air when it arrives |

</details>

## Response

`200 OK` — Returns a [PlayoutStatus](../models/playout/playout-status.md) object.

`409 Conflict`
