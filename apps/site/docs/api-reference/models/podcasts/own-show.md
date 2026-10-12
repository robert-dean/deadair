---
title: 'OwnShow'
sidebar_position: 9
mdx:
    format: 'md'
---

> A show the station makes for itself: a saved recipe for a podcast, whose every episode is a production

<details>
<summary>Attributes (11)</summary>

| Attribute     | Type                                  | Required | Description                                                                                                              |
| ------------- | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`          | `string`                              | Yes      | _read-only_                                                                                                              |
| `title`       | `string`                              | Yes      | What the show is called. Each episode's title starts with it                                                             |
| `description` | `string`                              | No       | What the show is, for the console. Never read out                                                                        |
| `subject`     | `string`                              | No       | What an episode is about when it is asked for with no subject of its own                                                 |
| `personaId`   | `string`                              | No       | Who presents it. Absent is whoever is presenting when it is made                                                         |
| `targetMs`    | `number`                              | No       | How long an episode runs. Absent is the station's production length                                                      |
| `writingMode` | `'quick' \| 'outlined' \| 'polished'` | No       | How much of the model an episode is worth. Absent is the station's default                                               |
| `newsFeedIds` | `string[]`                            | No       | The station's news feeds an episode reads, by their qualified ids. Absent or empty is a show that does not read the news |
| `newsHours`   | `number`                              | No       | How many hours of news an episode reads. Absent is a day                                                                 |
| `research`    | `boolean`                             | No       | Whether an episode given nothing to read finds its own sources on the operator's trusted sites                           |
| `createdAt`   | `string`                              | Yes      | _read-only_                                                                                                              |

</details>
