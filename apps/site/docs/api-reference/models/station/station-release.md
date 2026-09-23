---
title: 'StationRelease'
sidebar_position: 13
mdx:
    format: 'md'
---

> One release of the station, in the words its changelog entry used

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                                                  |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `version` | `string` | Yes      | The release, as its tag names it without the leading `v`. _read-only_                                        |
| `date`    | `string` | No       | The day it went out, as an ISO date. Absent where the entry named none. _read-only_                          |
| `notes`   | `string` | Yes      | What changed, as the Markdown of its changelog entry. Empty for a release that recorded nothing. _read-only_ |

</details>
