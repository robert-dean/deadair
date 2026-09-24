---
title: 'ListenerRequest'
sidebar_position: 5
mdx:
    format: 'md'
---

> A record somebody asked the station to play, and what became of it

<details>
<summary>Attributes (11)</summary>

| Attribute       | Type            | Required | Description                                                                                                                                                                                                |
| --------------- | --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `string`        | Yes      |                                                                                                                                                                                                            |
| `status`        | `RequestStatus` | Yes      | `waiting` for an operator to approve it, `pending` while its audio is fetched or a place is found for it, `queued` in the running order, `aired` once heard, `declined` or `expired` when it never will be |
| `title`         | `string`        | Yes      | The record, as it was called when it was asked for                                                                                                                                                         |
| `artist`        | `string`        | Yes      |                                                                                                                                                                                                            |
| `requesterName` | `string`        | Yes      | Who asked, by the name their account or chat platform gave                                                                                                                                                 |
| `source`        | `RequestSource` | Yes      | Whether it came from an app or a chat platform                                                                                                                                                             |
| `createdAt`     | `string`        | Yes      | When it was asked for                                                                                                                                                                                      |
| `reason`        | `string`        | No       | Why it was declined or expired, in the station's words or an operator's                                                                                                                                    |
| `airedAt`       | `string`        | No       | When it aired                                                                                                                                                                                              |
| `dedicateTo`    | `string`        | No       | Who the listener dedicated it to                                                                                                                                                                           |
| `message`       | `string`        | No       | What the listener asked to have said with it, in their own words                                                                                                                                           |

</details>
