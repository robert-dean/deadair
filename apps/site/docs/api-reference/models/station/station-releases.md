---
title: 'StationReleases'
sidebar_position: 14
mdx:
    format: 'md'
---

> What this build is, and what changed in it

<details>
<summary>Attributes (2)</summary>

| Attribute | Type               | Required | Description                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current` | `string`           | No       | The newest release this build contains, read off the changelog it was built with. Present on a build that follows `main` too, where `version` on the check-up is absent: every build carries the entry of the last release merged before it. Absent only when the build carries no changelog to read. _read-only_ |
| `notes`   | `StationRelease[]` | Yes      | Every release this build contains, newest first. _read-only_                                                                                                                                                                                                                                                      |

</details>
