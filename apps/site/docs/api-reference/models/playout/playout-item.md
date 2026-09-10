---
title: 'PlayoutItem'
sidebar_position: 3
mdx:
    format: 'md'
---

> One item in the running order, as the console sees it

<details>
<summary>Attributes (10)</summary>

| Attribute    | Type       | Required | Description                                                                                                                    |
| ------------ | ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`         | `string`   | Yes      | deadair's own id for this item, not the provider's: a playlist may hold the same track twice                                   |
| `pluginId`   | `string`   | Yes      |                                                                                                                                |
| `externalId` | `string`   | Yes      | The track's id in its plugin's id space                                                                                        |
| `title`      | `string`   | Yes      |                                                                                                                                |
| `artists`    | `string[]` | Yes      |                                                                                                                                |
| `durationMs` | `number`   | No       | Integer milliseconds. Deliberately not the `duration` scalar, which is a Luxon `Duration` over an ISO-8601 string              |
| `album`      | `string`   | No       |                                                                                                                                |
| `artworkUrl` | `string`   | No       | The locally cached cover where there is one, the provider's URL otherwise                                                      |
| `year`       | `number`   | No       | First release year, when the catalog knows one                                                                                 |
| `trackId`    | `string`   | No       | The canonical `deadair.tracks` id, when this item is a track the catalog holds. Absent for anything the catalog has never seen |

</details>
