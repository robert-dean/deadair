---
title: 'UnreadableMount'
sidebar_position: 5
mdx:
    format: 'md'
---

> An Icecast mount whose connections could not be read, so its listeners are missing from the list

<details>
<summary>Attributes (2)</summary>

| Attribute | Type                                        | Required | Description                                                                                                                                                                                        |
| --------- | ------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mount`   | `string`                                    | Yes      |                                                                                                                                                                                                    |
| `reason`  | `'unresolved' \| 'refused' \| 'unanswered'` | Yes      | `unresolved`: the station has not yet found an Icecast 2.5 it can ask. `refused`: Icecast answered 401 or 403. `unanswered`: a timeout, a failed connection, or a reply that was not a client list |

</details>
