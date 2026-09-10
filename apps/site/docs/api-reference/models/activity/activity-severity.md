---
title: 'ActivitySeverity'
sidebar_position: 2
mdx:
    format: 'md'
---

> How an entry reads, not how bad it is. There is deliberately no `waiting`: a station idling for
> want of a listener says so in its own words and stays `info`, for the same reason the transport
> reports it as `ready` rather than as a mild fault

```typescript
type ActivitySeverity = 'info' | 'warn' | 'fault';
```
