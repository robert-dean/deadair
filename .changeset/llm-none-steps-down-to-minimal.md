---
'@deadair/plugin-llm': patch
---

With thinking set to **Off**, a model that cannot switch thinking off entirely and refuses `none` is now asked for `minimal` instead, rather than having the thinking level dropped from the request. Dropping it left such a model on its own default, thinking at full length on every call, which made breaks slow to write and spent far more tokens than the setting asked for. The step-down is logged once per provider and lasts until the plugin is reconfigured; Low, Medium and High still go out as set. A server that does not know the thinking field at all still has it dropped, as before, and so does one that refuses `minimal` too.
