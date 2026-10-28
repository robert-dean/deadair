---
'@deadair/api': minor
---

The station can count what its model calls cost. Settings, Language model, has a new list, What each model costs: a model and its price per million input and output tokens, as your provider charges it. Each call is priced as it is made, so changing a price later moves only what follows, and a model with no price is still counted in tokens. The figures are kept on the station's trends, and sent on to an OpenTelemetry collector as a counter when one is set.
