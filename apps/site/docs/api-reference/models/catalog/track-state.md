---
title: 'TrackState'
sidebar_position: 14
mdx:
    format: 'md'
---

> Which records to show, by what the station has of them rather than by what they are.
>
> cached the audio is on this machine, so it can be committed to the running order now
> uncached it is not, which for most of a library is ordinary rather than wrong
> unmeasured no trustworthy measurement, so no cue points and no level decided before air
> benched every copy written off, which is the one state that means it CANNOT air
> failing a fetch has failed and is backing off. Not benched yet, and often the state before it

```typescript
type TrackState = 'cached' | 'uncached' | 'unmeasured' | 'benched' | 'failing';
```
