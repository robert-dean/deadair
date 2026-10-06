---
'@deadair/api': patch
---

The presenter no longer makes up the weather. A break that was given no weather reading was already refused for describing the sky anyway; that check now also catches "windy", "gusty", "blustery", "humid", "muggy", "heatwave", "rainfall", "pouring down" and "scattered showers", while words that usually mean something else on air ("sunshine", "stormy", "chilly") still pass. Phone-ins and other programmes written in polished mode now apply the same check to the host: a host turn that describes the weather is re-drafted once without it. A caller may still talk about the weather where they are, and once a caller or the programme's brief has brought it up, the host may answer.
