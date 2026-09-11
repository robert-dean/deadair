---
title: 'ConfigFieldControl'
sidebar_position: 5
mdx:
    format: 'md'
---

> The control a field asks to be drawn with, where the ordinary one for its type reads badly. Opt-in
> per field rather than inferred, because a slider is right for a value you feel for and wrong for
> one you have to hit exactly, and `tags` is right for a comma-separated line that is really a SET
> and wrong for one that is prose. Nothing about the stored value changes either way

```typescript
type ConfigFieldControl = 'slider' | 'tags';
```
