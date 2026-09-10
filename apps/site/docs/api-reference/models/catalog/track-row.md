---
title: 'TrackRow'
sidebar_position: 18
mdx:
    format: 'md'
---

> A track as a LIST shows it: the record, plus three facts about what the station has of it.
>
> Three booleans and no more, deliberately. They are what a row can afford — one `exists` each, off
> the query that was already running — and everything wider (which providers, how many bytes, why the
> last fetch failed) is `TrackDetail`'s, one click away. A fourth would be the beginning of putting
> the detail page in a table cell.

Extends [`Track`](./track.md)

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type      | Required | Description                                                                       |
| ---------- | --------- | -------- | --------------------------------------------------------------------------------- |
| `hasAudio` | `boolean` | Yes      | The bytes are on this machine. _read-only_                                        |
| `measured` | `boolean` | Yes      | Measured, COMPLETE, and at a schema version the station still trusts. _read-only_ |
| `enriched` | `boolean` | Yes      | At least one provider has answered about it. _read-only_                          |

</details>
