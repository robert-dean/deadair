---
title: 'StationPiece'
sidebar_position: 3
mdx:
    format: 'md'
---

> One instalment, and what the station has done with it

<details>
<summary>Attributes (20)</summary>

| Attribute           | Type                   | Required | Description                                                                                                                           |
| ------------------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `string`               | Yes      | The station's own id for this piece                                                                                                   |
| `seriesId`          | `string`               | Yes      | Qualified, matching `StationSeries.id`                                                                                                |
| `pieceId`           | `string`               | Yes      | The plugin's own id for the piece, stable across refreshes                                                                            |
| `seriesTitle`       | `string`               | Yes      |                                                                                                                                       |
| `title`             | `string`               | Yes      |                                                                                                                                       |
| `order`             | `'serial' \| 'latest'` | Yes      | How its series is worked through, copied onto the piece by every refresh                                                              |
| `author`            | `string`               | No       |                                                                                                                                       |
| `summary`           | `string`               | No       | What it is about, as plain text                                                                                                       |
| `url`               | `string`               | No       | The piece's page, for a person                                                                                                        |
| `artworkUrl`        | `string`               | No       |                                                                                                                                       |
| `ordinal`           | `number`               | No       | Where it comes in a serial, from 0. Absent for a `latest` series                                                                      |
| `publishedAt`       | `string`               | No       | ISO-8601                                                                                                                              |
| `wordCount`         | `number`               | No       | Roughly how many words it runs to, as the plugin counted them                                                                         |
| `seenAt`            | `string`               | Yes      | ISO-8601: when a refresh last saw it listed                                                                                           |
| `rendered`          | `boolean`              | Yes      | Whether the station has the spoken audio, ready to air                                                                                |
| `rendering`         | `boolean`              | Yes      | Whether the words are being spoken right now                                                                                          |
| `renderRequestedAt` | `string`               | No       | ISO-8601: when the station last asked for it to be spoken                                                                             |
| `renderError`       | `string`               | No       | Why the last attempt to speak it failed, when it did                                                                                  |
| `scheduledFor`      | `string`               | No       | ISO-8601: the slot it was made for                                                                                                    |
| `airedAt`           | `string`               | No       | ISO-8601: when a listener could first have heard it. A piece airs once, and for a serial this is also the station's place in the book |

</details>
