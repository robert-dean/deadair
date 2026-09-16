---
'@deadair/api': patch
---

A record now reaches air with the station's own cover rather than the provider's, even when it was picked before the art store had one. The running order stores the cover a record was picked with and nothing revisited it, so a cover fetched afterwards never reached the record it belonged to and that record aired under the station's logo. The director now resolves it on every commit pass and asks for any cover the store has never seen, ahead of the scheduled sweep, which walks the catalog alphabetically and has no idea what is on tonight. A cover that is late, failed or unreadable still just shows the logo and never holds up a record.
