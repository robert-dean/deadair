# Music licensing

**deadair is broadcast infrastructure. It grants you no rights to the music you play through it, and
it ships with none.** This page is the plain answer to the questions an operator actually asks
before pointing a station at the internet. It is general information and not legal advice; if you
run a station anybody can tune into, the person to ask is a media or intellectual-property lawyer in
your own country.

## Does owning the music cover it?

No, and this is the one that surprises people. Buying a download, ripping a CD you own, or holding a
subscription to a streaming service covers **private listening**. Playing that same file to anybody
else is a **public performance**, which is a separate right that nobody sells you along with the
record.

The moment your stream is reachable by someone who is not you, you are the broadcaster.

## Which rights, and how many?

Two, and they are administered separately, which is why one licence is rarely the whole answer:

- **The composition** — the song as written. Collected in the UK by PRS for Music, in the US by
  ASCAP, BMI and SESAC, and by an equivalent body nearly everywhere else.
- **The sound recording** — the specific master you are playing. Collected in the UK by PPL, in the
  US by SoundExchange under the statutory webcasting licence, which carries its own conditions on
  how often you may play the same artist or album in a row.

A licence covering one does not cover the other.

## Does being non-commercial exempt me?

No. The rule is about **public performance**, not about money. A station with no adverts, no
subscribers and four listeners is still performing publicly. Some collecting societies price a small
or non-commercial webcaster very cheaply, which is a different thing from exempting one.

## What about a private station?

Materially lower risk, and the distinction is real rather than a technicality: a stream only you can
reach is closer to private listening than to broadcasting. deadair does not currently ship a
listener-authentication gate on the mount — what it has is the leased mount and the audience gate,
which are about not broadcasting to nobody rather than about keeping anybody out. So a private
station today means keeping the address private: a LAN, a VPN, or a tunnel with authentication in
front of it.

Note that "unlisted" is not "private". An address nobody has published is still reachable by
anybody who finds it.

## What is unambiguously clear?

Three kinds of material, and running a station on them needs nothing from anybody:

- **Recordings you made or own outright**, where you control both rights.
- **Permissively licensed music** — Creative Commons and the like — used within the terms of its
  licence. Read them: several forbid commercial use and several require attribution, which for a
  radio station means saying so on air or on the page.
- **Public-domain recordings**, remembering that the composition and the recording expire on
  different clocks. A 1920s song is very likely public domain; a 1990s recording of it is not.

## Is there anything that helps if a question comes up later?

Yes, and it is worth switching on before you need it rather than after: **the station records what it
played.** `deadair.play_history` holds every spin with its timestamp and its broadcast id, and the
activity feed reads it back. If a collecting society asks what you played and when — which is what a
reporting obligation usually amounts to — that is the record, and it exists whether or not anybody
ever asks.

## What deadair itself does about all this

Nothing, deliberately. It does not check licences, it does not know which country you are in, and it
will happily play whatever your library holds. That is the same posture a mixing desk and a stream
server take, and it is the honest one: the software cannot know what you are cleared for, and
pretending to would be worse than saying so.
