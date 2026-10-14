---
title: 'PersonaFilePersona'
sidebar_position: 20
mdx:
    format: 'md'
---

> One character in a file. `PersonaDraftView` is the sheet with no id and not on air, which is
> exactly what travels, plus the two fields a model is deliberately not asked for and a real install
> always knows: what the character is FOR, and which rack it has to hand

Extends [`PersonaDraftView`](./persona-draft-view.md)

<details>
<summary>Attributes (4)</summary>

| Attribute    | Type                                                | Required | Description                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`       | `'host' \| 'caller' \| 'newsreader' \| 'guest'`     | No       | The one kind a `deadair.persona/2` file carries, read as a character of that kind alone. Absent, with no `kinds`, means `host`, as everywhere else                                                                     |
| `kinds`      | `('host' \| 'caller' \| 'newsreader' \| 'guest')[]` | No       | What the character may be cast as, in any combination. Wins over `kind` when a file has both                                                                                                                           |
| `soundboard` | `string`                                            | No       | The board this character reaches for. Carried even though the receiving station may not hold it: a persona naming a rack that does not exist and one with no rack are the same state, and the import says which it got |
| `stories`    | `PersonaFileStory[]`                                | Yes      |                                                                                                                                                                                                                        |

</details>
