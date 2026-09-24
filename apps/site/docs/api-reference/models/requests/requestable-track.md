---
title: 'RequestableTrack'
sidebar_position: 1
mdx:
    format: 'md'
---

> A record the station holds and could be asked for

<details>
<summary>Attributes (5)</summary>

| Attribute | Type     | Required | Description                                   |
| --------- | -------- | -------- | --------------------------------------------- |
| `trackId` | `string` | Yes      | What to send as `trackId` to make the request |
| `title`   | `string` | Yes      |                                               |
| `artist`  | `string` | Yes      | The lead artist                               |
| `album`   | `string` | No       |                                               |
| `year`    | `number` | No       |                                               |

</details>
