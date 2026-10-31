---
'@deadair/plugin-llm': patch
---

A model that says reasoning is mandatory and cannot be disabled now gets the same step down to `minimal` as any other refused `none`, instead of failing the call and being marked down.
