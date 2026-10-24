---
title: 'BreakUrgency'
sidebar_position: 30
mdx:
    format: 'md'
---

> How soon a requested break wants to be heard. `interrupt` and `next` are written and spoken before they take a place in the running order, so they cannot reach their slot unready; `interrupt` lands at the first boundary that leaves time to write and speak it, `next` between the record on air and the one after. `soon` and `whenever` are planted like a break the station planned for itself, within a few records or at the next ordinary slot

```typescript
type BreakUrgency = 'interrupt' | 'next' | 'soon' | 'whenever';
```
