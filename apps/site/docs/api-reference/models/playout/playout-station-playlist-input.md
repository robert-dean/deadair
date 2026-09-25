---
title: 'PlayoutStationPlaylistInput'
sidebar_position: 2
mdx:
    format: 'md'
---

> A playlist the station owns, to load into the running order

<details>
<summary>Attributes (3)</summary>

| Attribute           | Type      | Required | Description                                                                                                                                                                                                                          |
| ------------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stationPlaylistId` | `string`  | Yes      |                                                                                                                                                                                                                                      |
| `mixInSimilar`      | `boolean` | No       | Whether records that sound like the ones on this playlist are mixed in among them, one every `rotation.mixInEvery` records. Absent takes the station's own setting, which is off                                                     |
| `callins`           | `boolean` | No       | Whether somebody phones in during this broadcast, exactly as `PutOnAirInput.callins`. Absent takes the station's own `rotation.callins`, so a station that takes calls needs an explicit `false` here to air a playlist without them |

</details>
