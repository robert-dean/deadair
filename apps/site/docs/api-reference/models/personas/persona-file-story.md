---
title: 'PersonaFileStory'
sidebar_position: 20
mdx:
    format: 'md'
---

> Something that happened to this character, as a file carries it. No `origin` and no `source`,
> unlike the stored row: whoever exported this stood behind every story in it, so on the far side
> they are the receiving operator's own, and a sentence about where a proposal came from names a
> catalogue that station does not have

<details>
<summary>Attributes (6)</summary>

| Attribute | Type                           | Required | Description                                                                                                                                                                                     |
| --------- | ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`   | `string`                       | Yes      |                                                                                                                                                                                                 |
| `story`   | `string`                       | Yes      |                                                                                                                                                                                                 |
| `kind`    | `'anecdote' \| 'arc' \| 'bit'` | No       | Absent means `anecdote`. What sort of thing this is travels because it is part of what the story IS, not part of what this station has done with it                                             |
| `state`   | `'active' \| 'rejected'`       | No       | Absent means `active`. A turned-down story travels so the enrichment pass does not propose it again on the far side; an undecided one does not travel at all, because nobody has decided it yet |
| `details` | `PersonaFileStoryDetail[]`     | Yes      |                                                                                                                                                                                                 |
| `beats`   | `PersonaFileStoryBeat[]`       | Yes      | The parts an arc is told in, in order. Empty for the other two kinds                                                                                                                            |

</details>
