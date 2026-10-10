---
'@deadair/api': patch
'@deadair/web': patch
---

Replan and Shuffle no longer throw away what somebody else put in the running order. A listener's request and its dedication, the records a request show chose to follow it, a production, a break somebody asked for, and any record or segment the operator added all keep their places; only the station's own records are chosen again or reshuffled around them. Before this, a replan dropped a queued request, which then lapsed hours later as having left the running order, and lost a production outright.
