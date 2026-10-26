---
title: 'PlayoutSkipQuery'
sidebar_position: 18
mdx:
    format: 'md'
---

> Which item a skip means to cut, as the caller last saw it on air

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                                                                                                                             |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item`    | `string` | No       | The id of the item on air as the caller last saw it (`PlayoutStatus.nowPlaying.item.id`). When it is no longer on air the skip is refused with a 409 and nothing is cut, so a press meant for a record that has just ended never takes off the one after it. Left out, the skip cuts whatever is on air when it arrives |

</details>
