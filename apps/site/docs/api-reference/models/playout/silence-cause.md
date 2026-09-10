---
title: 'SilenceCause'
sidebar_position: 6
mdx:
    format: 'md'
---

> Which gate is keeping the station quiet, or `airing` when none of them is. Ordered by cause: a
> stalled transport loop makes every reading under it stale, so it is ruled out first

```typescript
type SilenceCause =
    | 'airing'
    | 'transportStalled'
    | 'controlDenied'
    | 'streamUnreachable'
    | 'configNotAdopted'
    | 'stoodDown'
    | 'noProgramme'
    | 'noAudience'
    | 'warmingUp'
    | 'waitingOnAudio'
    | 'notDriving'
    | 'starved';
```
