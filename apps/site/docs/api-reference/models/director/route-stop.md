---
title: 'RouteStop'
sidebar_position: 21
mdx:
    format: 'md'
---

> One artist on a route, and how it connects to the one before

<details>
<summary>Attributes (5)</summary>

| Attribute     | Type                    | Required | Description                                                                                                                                             |
| ------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artist`      | `string`                | Yes      |                                                                                                                                                         |
| `link`        | `'credit' \| 'similar'` | No       | How this stop connects to the one before: a record the two are credited on together, or a similarity source naming them alike. Absent on the first stop |
| `sharedTitle` | `string`                | No       | For a shared credit, the record they share                                                                                                              |
| `sharedLead`  | `string`                | No       | For a shared credit, that record's lead artist                                                                                                          |
| `source`      | `string`                | No       | For a similarity link, the plugin whose answer it was                                                                                                   |

</details>
