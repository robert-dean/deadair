---
title: 'ArtistRoute'
sidebar_position: 22
mdx:
    format: 'md'
---

> A route between two artists, or the news that there is none

<details>
<summary>Attributes (4)</summary>

| Attribute | Type          | Required | Description                                                                                                            |
| --------- | ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `found`   | `boolean`     | Yes      | False when either end is not an artist the library holds a record by, or no route turned up within the search's bounds |
| `stops`   | `RouteStop[]` | Yes      | In order, the first artist first. Empty when nothing was found                                                         |
| `factual` | `number`      | Yes      | How many hops rest on a record the two artists share                                                                   |
| `similar` | `number`      | Yes      | How many hops rest on a similarity source's opinion                                                                    |

</details>
