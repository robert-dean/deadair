---
title: 'ReplanStationInput'
sidebar_position: 19
mdx:
    format: 'md'
---

> Throw away everything the player is not already holding and programme it again. Unlike a shuffle, the records themselves change; unlike putting the station on air, the broadcast continues

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                                                                                         |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `count`   | `number` | No       | How many records to programme. Absent is roughly an hour                                                                                                                                                                                                                            |
| `brief`   | `string` | No       | What the station should play from here on, in your own words. Absent keeps whatever this broadcast was already asked for; an empty string CLEARS it, which hands the programming back to the station's ordinary rotation. It steers every later refill too, not just this one batch |

</details>
