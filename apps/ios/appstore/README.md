# The App Store listing

What the App Store shows about this app, kept beside it so that a change to what the app does and a
change to what the store says about it land in the same commit. Nothing here is read by the build.

```
metadata/en-US/
  name.txt              30 characters at most
  subtitle.txt          30
  description.txt       4000
  keywords.txt          100, comma separated
  release_notes.txt     4000, the "What's New" text
  privacy_url.txt  support_url.txt  marketing_url.txt
screenshots/            empty until they are taken; see below
```

The names are fastlane `deliver`'s layout, as `apps/android/play` follows `supply`'s, so a tool that
pushes listings can take this directory as it is. Nothing pushes it today: paste a changed file into
App Store Connect. The release workflow uploads the build and nothing else, so `release_notes.txt`
is pasted into the version's "What's New" before it is submitted for review.

## Store settings

| Field | Value |
| --- | --- |
| Name | `deadair radio`, as `name.txt`. The home screen says `deadair`, which is what fits under an icon |
| Bundle ID | `com.maroonedsoftware.deadair`, the Android application id |
| Primary category | Music |
| Contact email | `ios@deadair.radio`, the one [`PRIVACY.md`](../PRIVACY.md) gives. They are one address on purpose; change both or neither |
| Privacy policy | https://github.com/robert-dean/deadair/blob/main/apps/ios/PRIVACY.md |

## App Privacy

**Data not collected.** The reading behind it is Android's: everything the app sends goes to a
server the user chose and runs, never to Marooned Software or a third party. Apple's definition of
collection is data transmitted off the device in a way that the developer or its partners can
access, and nothing here reaches either. If review reads the sign-in as collection, the answer to
switch to is Contact Info, Email Address, used for App Functionality, not linked to identity by us,
not used for tracking.

**Export compliance: exempt.** `ITSAppUsesNonExemptEncryption` is false in `Config/Info.plist`,
because the app uses only the encryption the operating system provides for HTTPS. Without the key
every build waits in TestFlight for somebody to answer the question by hand.

**Sign-in for review.** Listening needs no account, but the app opens on an empty address field, so
a reviewer with nothing to type can call it broken. The review notes give a reachable station's
address, written in App Store Connect only, because this tree names no operator's network. No
operator credentials: a reviewer holding them could stop the station for everyone listening.

## The screenshots

Taken on the simulator against a live station, when there is an app to take them of. The recipe, so
each set matches the last: the status bar fixed at 12:00 with a full battery and signal
(`xcrun simctl status_bar booted override --time 12:00 --batteryState charged --batteryLevel 100
--cellularBars 4 --wifiBars 3`), dark appearance, and no screen showing the station's address,
because this tree names no operator's network. The cover art is whatever the station was playing;
commercial artwork in a store screenshot can draw an intellectual-property rejection, and a set taken
while something else is on air is the fix if one arrives.
