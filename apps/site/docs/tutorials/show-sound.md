---
title: Give a show its own sound
description: Upload music beds, jingles and idents, give a show its own, and hear its breaks over a bed while every other show keeps the station's sound.
---

# Give a show its own sound

By the end of this page one show sounds like itself: its own jingles and idents between records, and
its own music bed playing quietly under every break its host speaks. Every other show keeps the
station's ordinary sound.

A **music bed** is a recording that runs under the words of a break and never airs on its own. Jingles
and idents are short recordings of the station saying its name. All three live on **Voice → Segments**, and each one is either for every show or for the shows you choose.
[Jingles](../features/breaks.md#jingles) and [Music beds](../features/breaks.md#music-beds) explain
them in full.

**You need** a station on air with a show on the timetable ([Make a show](./make-a-show.md)), and the
recordings themselves: a bed or two at least a minute long, and a few jingles or idents. Use audio you
are allowed to use. Laying a bed under a break needs the analysis sidecar, which is part of every
install unless you removed it.

## 1. Upload the recordings

Open **Voice → Segments** and press **Upload**. In **Upload a recording**:

1. Set **Kind** to `bed`.
2. Drop your bed files on **Drop audio here, or click to choose**. Each can be mp3, wav, ogg, flac or
   m4a, up to 50 MB.
3. Give each one a name under **What it is called on air**.
4. Press **Put it in the library** (or **Put all … in the library**).

Do the same with **Kind** set to `jingle` for jingles and `ident` for idents.

A recording is playable once it is ready, which takes a moment while the station measures it. Until
then the station skips it rather than waiting.

**Or drop them in the inbox.** Put the files in the segment inbox's `bed`, `jingle` or `ident` folder
and press **Scan the inbox** on the Segments page.

## 2. Give them to the show

Open **Programme → Timetable**, click the show to open its editor, and find **Sound**:

| Field | What to do |
| --- | --- |
| **Music under the breaks** | Leave it ticked. Untick it to keep this show's breaks as words alone. |
| **Jingles** | Choose the show's jingles. |
| **Idents** | Choose the show's idents. |
| **Music beds** | Choose the show's beds. |

Choices save as you make them. A recording marked "(every show)" in a list becomes this show's alone
when you choose it. A new show has to be saved once before its **Sound** section can be filled in.

The same choice can be made from the other side: on the Segments page, the pencil beside a recording's
**For** column picks the **Shows** and **Presenters** it is for. A recording for a presenter follows
them onto any show.

## 3. Set how far under the voice the bed sits

Open **Settings → Voice and audio** and set **Sit a music bed under the words by (dB)**. It is 18 under by
default, measured from how loud each bed is, so a quiet bed and a loud one sit at the same level.
Lower numbers make the bed louder.

For jingles, **Minutes between jingles** under Settings → Breaks sets how often one plays. Zero, the
default, means none unless the format clock books them.

## 4. Listen

While the show is on:

- **Its breaks play over one of its beds.** The bed starts a moment before the first word and fades
  out a moment after the last, and loops if the break runs longer than it. This covers the breaks the
  station writes: its own talk breaks, the breaks the format clock asks for, and a programme's
  introduction.
- **Its own jingles and idents play**, ahead of any that are for every show, and never another
  show's.
- **A break with a bed always airs between two records**, never talked over the start or end of one.

A recorded jingle or ident gets no bed, since it has its own sound, and neither does a phone-in.

Every other show plays the recordings marked for every show. A show with nothing of its own and no
every-show beds sounds as it always did.

The bed is chosen when a break is planned, so a change takes about an hour to be heard everywhere:
breaks already planned keep the bed they were given.

## With Claude

With Claude connected and allowed to **Read and manage**
([how](./connect-a-model.md#connect-claude-if-you-want-it-too)):

> List the music beds, jingles and idents in the segment library, then make the two warm beds and the
> After Hours jingles for After Hours only. Leave the rest for every show.

Claude can list recordings, scan the inbox and choose the shows a recording is for. Upload the files
yourself, on the Segments page or into the inbox.

## If it goes wrong

- **"That recording did not go into the library".** The file is not mp3, wav, ogg, flac or m4a, is
  over 50 MB, or has no audio in it. The message underneath says which.
- **The breaks have no bed under them.** Check that **Music under the breaks** is ticked on the show,
  that the bed is ready on the Segments page, and that the analysis sidecar is running. Without any of
  these the break airs as words, with no error. Breaks planned before your change keep what they had.
- **The bed is too loud or too quiet.** Change **Sit a music bed under the words by (dB)** under
  Settings → Voice and audio.
- **Another show lost its jingles.** Choosing an every-show recording on one show makes it that
  show's alone. Clear its choice on the Segments page to make it for every show again.
- **A show was deleted and its jingles stopped.** Recordings that were only for it stop airing rather
  than spreading to every show. Choose new shows for them, or clear the choice.

## Next

- [Make the news start on the dot](./on-the-dot.md), which uses a bed to wait for the time.
- [A show for a festival](./festival-show.md), a show that wants a sound of its own.
