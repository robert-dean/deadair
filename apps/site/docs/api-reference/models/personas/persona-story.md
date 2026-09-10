---
title: 'PersonaStory'
sidebar_position: 10
mdx:
    format: 'md'
---

> Something that happened to this character, in its own telling. Not a claim about the world and never
> checked as one: `source` says where a proposal came from, for the operator reading it, and nothing
> downstream reads it as evidence — see `persona.story.ts` for why that is the load-bearing difference
> from a fact

<details>
<summary>Attributes (10)</summary>

| Attribute    | Type                                    | Required | Description                                                                                                                 |
| ------------ | --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `string`                                | Yes      | _read-only_                                                                                                                 |
| `title`      | `string`                                | Yes      | A short handle. Never spoken; what this list is read by and what a proposal names                                           |
| `story`      | `string`                                | Yes      | The telling itself, in the character's voice. Already speakable, because the floor reads it as it stands                    |
| `state`      | `'active' \| 'suggested' \| 'rejected'` | Yes      | `active` can be told. `rejected` outlives the pass that proposed it, or the same catalogue proposes it forever. _read-only_ |
| `origin`     | `'operator' \| 'model'`                 | Yes      | Who says so. `model` is the enrichment pass writing from what the station already holds. _read-only_                        |
| `source`     | `string`                                | No       | Where a proposal came from, in the station's own words. Absent for anything an operator wrote. _read-only_                  |
| `details`    | `PersonaStoryDetail[]`                  | Yes      | What it has picked up since, in every state. _read-only_                                                                    |
| `lastToldAt` | `string`                                | No       | Absent means never told, which is what puts it at the front of the rotation. _read-only_                                    |
| `timesTold`  | `number`                                | Yes      | How often it has gone out, which changes how the model is asked to tell it. _read-only_                                     |
| `createdAt`  | `string`                                | Yes      | _read-only_                                                                                                                 |

</details>
