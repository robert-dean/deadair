# The faces this app ships

IBM Plex Sans and IBM Plex Mono, in six static instances (Sans 400/500/600/700, Mono 400/600).

Copyright 2017 IBM Corp. Licensed under the SIL Open Font License, Version 1.1, whose full text is
in `OFL.txt` beside this file. "IBM Plex" is a Reserved Font Name.

What the licence allows and does not, in the two lines that matter here: bundling the faces inside
an application and shipping that application, commercially or not, is permitted; selling the fonts
by themselves is not, and neither is shipping a modified version under the reserved name. Nothing in
this tree modifies them.

Fetched from the Google Fonts API's static instances, which is the only source that serves the
weights as separate TTFs: `ofl/ibmplexsans` in the Google Fonts repository now holds a VARIABLE font
only, and Skia (which Avalonia draws text with) reads TTF and OTF but has no dependable weight
selection over a variable axis. The upstream project is https://github.com/IBM/plex.

    curl "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700" -H "User-Agent: curl/8"

Two naming facts that decide whether a weight is reachable, both read out of the name tables rather
than assumed. Sans Medium and SemiBold carry a typographic family (name ID 16) of `IBM Plex Sans`,
so all four weights group under one family and `FontWeight` picks between them. Mono SemiBold does
NOT: its family name is `IBM Plex Mono SemiBold`, which is a family of its own. So asking for
`IBM Plex Mono` at SemiBold finds nothing to match and the weight is synthesised.
