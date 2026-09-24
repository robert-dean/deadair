---
title: 'PlaylistImportInput'
sidebar_position: 16
mdx:
    format: 'md'
---

> Something to import a playlist from. Exactly one source

<details>
<summary>Attributes (7)</summary>

| Attribute          | Type                       | Required | Description                                                                                                      |
| ------------------ | -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `file`             | `PlaylistFile`             | No       | A playlist exported from a deadair station                                                                       |
| `text`             | `string`                   | No       | A playlist another program wrote, as its text: an M3U, a CSV with a header row, or one `Artist - Title` per line |
| `format`           | `'m3u' \| 'csv' \| 'text'` | No       | Which of those `text` is. Absent works it out from the text                                                      |
| `fileName`         | `string`                   | No       | The name of the file `text` came from, which names the playlist when the text does not                           |
| `url`              | `string`                   | No       | A link to a playlist at one of the station's music sources, as a browser or an app shows it                      |
| `providerPlaylist` | `PlaylistProviderRef`      | No       | A playlist a music source lists here, by its plugin and its id                                                   |
| `name`             | `string`                   | No       | What to call the new playlist. Absent keeps the name the source gives it                                         |

</details>
