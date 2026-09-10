---
title: 'TrackEnrichmentData'
sidebar_position: 24
mdx:
    format: 'md'
---

> `releaseDate` is a string and not `datetime` because it is a partial date: MusicBrainz answers
> `1997`, `1997-06` or `1997-06-24` depending on what is actually known about the release, and the
> SDK types it the same way. A `datetime` would reject the first two or invent a day and a time
> for them, which is a precision the source never claimed.

<details>
<summary>Attributes (17)</summary>

| Attribute     | Type                      | Required | Description                                                                                     |
| ------------- | ------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `artist`      | `string`                  | No       |                                                                                                 |
| `title`       | `string`                  | No       |                                                                                                 |
| `album`       | `string`                  | No       |                                                                                                 |
| `year`        | `number`                  | No       |                                                                                                 |
| `releaseDate` | `string`                  | No       |                                                                                                 |
| `genres`      | `string[]`                | No       |                                                                                                 |
| `moods`       | `string[]`                | No       |                                                                                                 |
| `biography`   | `string`                  | No       |                                                                                                 |
| `facts`       | `string[]`                | No       | Short lines, each independently speakable                                                       |
| `bpm`         | `number`                  | No       | Not an integer: a tempo a source measured rather than declared is fractional                    |
| `musicalKey`  | `string`                  | No       |                                                                                                 |
| `label`       | `string`                  | No       |                                                                                                 |
| `isrc`        | `string`                  | No       |                                                                                                 |
| `artworkUrl`  | `string`                  | No       |                                                                                                 |
| `externalIds` | `EnrichmentExternalId[]`  | No       |                                                                                                 |
| `links`       | `EnrichmentLink[]`        | No       |                                                                                                 |
| `extra`       | `Record<string, unknown>` | No       | What the plugin said that the SDK has no field for. Per provider only: the merged view drops it |

</details>
