---
title: 'StationOrderItem'
sidebar_position: 11
mdx:
    format: 'md'
---

> One item of the live running order, and where it has got to

<details>
<summary>Attributes (21)</summary>

| Attribute       | Type                                                                                  | Required | Description                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `string`                                                                              | Yes      | What an edit names, what rides through the player, and what comes back on its readings                                                                            |
| `kind`          | `'track' \| 'segment'`                                                                | Yes      | Whether this is a record or something the station says: an ident, a stinger, a talk break                                                                         |
| `state`         | `StationItemState`                                                                    | Yes      |                                                                                                                                                                   |
| `title`         | `string`                                                                              | Yes      | The record's title, or the segment's label. What the mount is labelled with while it airs                                                                         |
| `artists`       | `string[]`                                                                            | Yes      | Empty for a segment, which has no artist                                                                                                                          |
| `durationMs`    | `number`                                                                              | No       |                                                                                                                                                                   |
| `pluginId`      | `string`                                                                              | No       | Absent on a segment: the station serves its own audio                                                                                                             |
| `externalId`    | `string`                                                                              | No       | Absent on a segment                                                                                                                                               |
| `album`         | `string`                                                                              | No       |                                                                                                                                                                   |
| `artworkUrl`    | `string`                                                                              | No       |                                                                                                                                                                   |
| `year`          | `number`                                                                              | No       |                                                                                                                                                                   |
| `trackId`       | `string`                                                                              | No       | The canonical catalog track, when this is one the catalog holds                                                                                                   |
| `artistId`      | `string`                                                                              | No       | The canonical artist behind that track, so a console can reach their page from the running order. Absent on a segment, and on a record the catalog has never seen |
| `albumId`       | `string`                                                                              | No       | The release that track was ingested inside. Absent for the two reasons above and for a third: a single ingested outside any release has none                      |
| `rating`        | `Rating`                                                                              | No       | What the station thinks of this record, read as the order is drawn rather than stored on it. Absent on a segment, and on a record the catalog has never seen      |
| `segmentId`     | `string`                                                                              | No       | Which segment this plays. Present only on a segment                                                                                                               |
| `segmentState`  | `'planned' \| 'writing' \| 'written' \| 'rendering' \| 'ready' \| 'failed' \| 'gone'` | No       |                                                                                                                                                                   |
| `playable`      | `boolean`                                                                             | No       | Whether the station can actually air this segment. One that cannot is SKIPPED when it comes round, rather than held open                                          |
| `segmentError`  | `string`                                                                              | No       | Why this segment will not air, in a sentence. Present only on a failed one                                                                                        |
| `segmentWriter` | `string`                                                                              | No       | What decided the words: the station's own templates, or the model that wrote them. Absent on a recording somebody made                                            |
| `overAtMs`      | `number`                                                                              | No       | Heard OVER the record that follows, this far into it, with the music ducked under it. Such an item is never handed to the player in its own right                 |

</details>
