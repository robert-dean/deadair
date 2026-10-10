---
title: 'StationOrder'
sidebar_position: 12
mdx:
    format: 'md'
---

> The station's live running order: what is airing, item by item

<details>
<summary>Attributes (14)</summary>

| Attribute          | Type                 | Required | Description                                                                                                                                                                                              |
| ------------------ | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | `string`             | Yes      | What is on, for a console to draw. A label for this broadcast rather than the name of a stored object                                                                                                    |
| `brief`            | `string`             | No       | What the operator asked the station to play, in their own words. It keeps steering every refill until the station is put on air again, so a console should show it rather than only accept it            |
| `personaId`        | `string`             | No       | Who is hosting this broadcast, when it named somebody. Absent means whichever persona the station has on air                                                                                             |
| `personaLabel`     | `string`             | No       | What that host is called, resolved as the order is read so a console need not fetch the persona list to draw a name                                                                                      |
| `coHostPersonaIds` | `string[]`           | No       | Who presents beside the host on this broadcast, in order: the co-hosts the schedule put on for tonight. Absent is one voice                                                                              |
| `mode`             | `StationMode`        | Yes      |                                                                                                                                                                                                          |
| `onEnd`            | `StationOnEnd`       | Yes      |                                                                                                                                                                                                          |
| `source`           | `string`             | Yes      | Who built it: `import`, `chart` or `director`                                                                                                                                                            |
| `sourcePluginId`   | `string`             | No       | Where more material is pulled from, when it came from a playlist                                                                                                                                         |
| `sourcePlaylistId` | `string`             | No       | The playlist it was built from. With no `sourcePluginId`, a playlist the station owns                                                                                                                    |
| `sourceChartId`    | `string`             | No       | The published chart this broadcast was built from, qualified with the plugin that offered it. Provenance rather than a binding: a chart is a fixed document, so it is read once and never topped up from |
| `requestShow`      | `boolean`            | No       | Whether this is a request show, on which each listener request is followed by records like it. Absent is an ordinary show                                                                                |
| `requestFollowOn`  | `number`             | No       | How many records follow each request on a request show. Present only on one                                                                                                                              |
| `items`            | `StationOrderItem[]` | Yes      |                                                                                                                                                                                                          |

</details>
