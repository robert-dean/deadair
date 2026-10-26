---
title: 'LiveState'
sidebar_position: 14
mdx:
    format: 'md'
---

> What the live input is doing. `off`: not armed, whatever is connected to it. `armed`: waiting for real signal from an encoder. `preroll`: signal heard, counting down to the cut. `onair`: the presenter is on the air, above the station's own programme

```typescript
type LiveState = 'off' | 'armed' | 'preroll' | 'onair';
```
