# The Play listing

What Google Play shows about this app, kept beside it so that a change to what the app does and a
change to what the store says about it land in the same commit. Nothing here is read by the build.

```
listing/en-US/
  title.txt                 30 characters at most
  short_description.txt     80
  full_description.txt      4000
  images/
    icon.png                512x512, generated
    featureGraphic.png      1024x500, generated
    phoneScreenshots/       2 to 8, portrait
whatsnew/
  whatsnew-en-US            the release notes, 500 characters at most
```

`whatsnew/` is the one part that IS pushed: the publish workflow uploads it as the notes of every
build, so it is edited in the commit before a publish. A build uploaded with last release's notes
tells every tester the same news twice.

The names are fastlane `supply`'s layout, so a tool that pushes listings can take this directory as
it is. Nothing pushes it today: listing edits are rare enough to paste into Play Console → Grow →
Store presence → Main store listing. When one of these files changes, paste it.

`icon.png` and `featureGraphic.png` come out of `tools/make-launcher-icon.py` with the launcher
icon, so the store and the phone cannot show two different marks. Do not edit them by hand.

### The screenshots

Taken on the emulator against a live station, at `adb shell wm size 1080x1920`. Not the device's
own 1080x2400, because Play refuses a screenshot longer than twice its width, and 16:9 is also the
shape on which the Now playing layout is tightest, so a shot that looks right there looks right
everywhere. The rest of the recipe, so the next set matches this one:

- dark theme (`cmd uimode night yes`) with wallpaper colours OFF, which is the station's own green
  on carbon rather than whatever the emulator's wallpaper suggests
- the status bar in demo mode: `settings put global sysui_demo_allowed 1`, then the
  `com.android.systemui.demo` broadcasts for a 12:00 clock, a full battery and full wifi
- the emulator's own notifications snoozed (`cmd notification snooze`) before the shade is shot
- no screen showing the station's address, which is why the format picker is scrolled past it.
  This tree names no operator's network, and a screenshot is part of the tree

Saved as 24-bit PNG, because Play refuses an alpha channel. The cover art is whatever the station
was playing. Commercial artwork in a store screenshot can draw an intellectual-property rejection,
and a set taken while something else is on air is the fix if one arrives.

Only the listener's screens are here. Up next, Played, What's on and the record pages need a
signed-in operator, and are the ones worth adding next.

## Store settings

| Field | Value |
| --- | --- |
| App name | `deadair radio`, as `title.txt`. The launcher still says `deadair` (`app_name`), which is what fits under an icon |
| Category | Music & Audio |
| Contact email | the one [`PRIVACY.md`](../PRIVACY.md) gives |
| Website | https://deadair.radio |
| Privacy policy | https://github.com/robert-dean/deadair/blob/main/apps/android/PRIVACY.md |

## App content

Policy → App content in the console. Each answer is given with the fact that decides it, so the
next person can tell whether the answer is still true rather than copying it forward.

**Ads: no.** There is no ad SDK and nothing is sold.

**App access: some functionality is restricted.** The app opens on an empty address field, and a
reviewer with nothing to type into it will call it broken. The instructions give a reachable
station's address, and that address is written in the console only: this tree names no operator's
network, and this file is no exception. Suggested wording:

> Enter the station address below on the first screen and press Check, then Listen. Everything a
> listener sees works without an account. Signing in is for the person who operates the station
> and controls what it broadcasts, which is why no listener account exists to give you.

Giving the reviewer operator credentials as well is a separate decision. They would reach every
screen, and they would also be able to skip records and stop the station for everyone listening.

**Content rating.** The facts the questionnaire asks about: there is no interaction between users,
no location is shared, nothing is bought, there is no gambling and no general web browsing. The
audio is whatever the station plays, which its operator chooses, and it can include explicit
lyrics. Answer the language questions with that in mind rather than as though the app ships its
own content.

**Target audience: 18 and over.** The app is not directed at children (`PRIVACY.md` says so), and
the music a station plays is not filtered by this app. Choosing any band under 13 brings in the
Families policy, which this app is not built to meet.

**News app: no.** A station may air news bulletins, but the app is a player for one station, not a
news publisher. Likewise no to the government, financial, health and COVID-19 declarations.

**Data safety.** Google defines collection as any data transmitted off the device, whoever receives
it, so the conservative reading is the one declared:

| Question | Answer | Why |
| --- | --- | --- |
| Collects or shares data | Yes, collects | Signing in sends an email address and password to the station |
| Data types | Personal info → Email address | The password is not a listed type and is never stored; the tokens are the station's, not data about the user |
| Optional | Yes | Listening needs no account |
| Purpose | Account management | It is how the station knows who is operating it |
| Shared | No | It goes only to the station the user chose, never to Marooned Software or anyone else |
| Encrypted in transit | No | Plain HTTP is allowed, because a home install has no certificate. Answering yes would be untrue for exactly those users |
| Deletion | No mechanism | Marooned Software holds no copy. The station's operator can delete the account; the app's own copy goes on sign-out and on uninstall |

The IP address and the `deadair-android/<version>` User-Agent reach the station too, as they reach
any server a phone connects to. Neither is a data type the form lists. What an operator does from
the phone (a skip, a rating) is a command to their own station rather than data about them.

**Foreground service: media playback.** The console asks what the service does and for a video
link showing it. Description:

> Plays the radio station the user chose, and keeps playing when the app is in the background or
> the screen is off. Started only when the user presses play, in the app, on the notification, on
> a Bluetooth device or from Android's media controls; stopped when they press stop.

The video is a screen recording of pressing play, going to the home screen, turning the screen off
and back on, and stopping from the notification. Unlisted on YouTube is what the console expects.
