---
title: 'TrackSort'
sidebar_position: 15
mdx:
    format: 'md'
---

> What a track list is ordered BY. Its own enum for `TrackQuery`'s own reason: none of these keys
> means anything about an artist, and `name` is spelled `title` on a song.
>
> `state` is deliberately absent. It is three independent booleans rather than one column, so there
> is no ordering of it an operator would agree with: a benched record and an unmeasured one are not
> more or less than each other.

```typescript
type TrackSort = 'title' | 'artist' | 'album' | 'year' | 'duration' | 'rating';
```
