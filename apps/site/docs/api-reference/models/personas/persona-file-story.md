---
title: 'PersonaFileStory'
sidebar_position: 18
mdx:
    format: 'md'
---

> Something that happened to this character, as a file carries it. No `origin` and no `source`,
> unlike the stored row: whoever exported this stood behind every story in it, so on the far side
> they are the receiving operator's own, and a sentence about where a proposal came from names a
> catalogue that station does not have

<details>
<summary>Attributes (4)</summary>

| Attribute | Type                       | Required | Description                                                                                                                                                                                     |
| --------- | -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`   | `string`                   | Yes      |                                                                                                                                                                                                 |
| `story`   | `string`                   | Yes      |                                                                                                                                                                                                 |
| `state`   | `'active' \| 'rejected'`   | No       | Absent means `active`. A turned-down story travels so the enrichment pass does not propose it again on the far side; an undecided one does not travel at all, because nobody has decided it yet |
| `details` | `PersonaFileStoryDetail[]` | Yes      |                                                                                                                                                                                                 |

</details>
