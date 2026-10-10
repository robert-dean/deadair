---
title: 'TrackLyrics'
sidebar_position: 13
mdx:
    format: 'md'
---

> The station's answer for one record's lyrics: the words from the source it believes, or that nobody
> sings on it, or nothing. Timings count from the start of the file, as the vocal markers' do, so a
> player following along adds the record's cue-in to how long it has been on air.

<details>
<summary>Attributes (6)</summary>

| Attribute  | Type                                  | Required | Description                                                                                          |
| ---------- | ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `trackId`  | `string`                              | Yes      | _read-only_                                                                                          |
| `kind`     | `'words' \| 'instrumental' \| 'none'` | Yes      | The words are here; a source says nobody sings on it; or no source has an answer yet. _read-only_    |
| `provider` | `string`                              | No       | The plugin whose answer this is, when kind is words or instrumental. _read-only_                     |
| `plain`    | `string`                              | No       | The words without timings, when that source has them. _read-only_                                    |
| `synced`   | `LyricLineDetail[]`                   | No       | The timed lines, when that source has them. Preferred over plain when choosing a source. _read-only_ |
| `language` | `string`                              | No       | A BCP 47 tag, when the source stated one. _read-only_                                                |

</details>
