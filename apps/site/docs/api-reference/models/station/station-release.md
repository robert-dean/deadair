---
title: 'StationRelease'
sidebar_position: 13
mdx:
    format: 'md'
---

> One release of the station, in the words its changelog entry used

<details>
<summary>Attributes (4)</summary>

| Attribute | Type     | Required | Description                                                                                                                           |
| --------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `version` | `string` | Yes      | The release, as its tag names it without the leading `v`. _read-only_                                                                 |
| `date`    | `string` | No       | The day it went out. Absent where the entry named none. _read-only_                                                                   |
| `notes`   | `string` | Yes      | What changed, as the Markdown of its changelog entry. Empty for a release that recorded nothing. _read-only_                          |
| `url`     | `string` | No       | The release's page on GitHub. Present on a release this station does not contain yet, which is where its notes came from. _read-only_ |

</details>
