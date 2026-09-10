---
title: 'SilenceState'
sidebar_position: 7
mdx:
    format: 'md'
---

> How one gate is doing. `waiting` is its own state rather than a mild fault, because a station
> idling for want of a listener and a station that cannot reach its stream are both silent and only
> one of them is something to go and fix

```typescript
type SilenceState = 'ok' | 'waiting' | 'fault';
```
