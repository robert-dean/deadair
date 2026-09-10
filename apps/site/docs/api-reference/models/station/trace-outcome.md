---
title: 'TraceOutcome'
sidebar_position: 13
mdx:
    format: 'md'
---

> Whether a call produced what it was asked for. Two values on purpose: every finer distinction —
> timed out, was preempted, came back empty — is a fact the caller knew and the recorder did not, so
> it lives in `detail` where it can be named

```typescript
type TraceOutcome = 'ok' | 'failed';
```
