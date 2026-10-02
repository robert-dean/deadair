import SwiftUI

/// Which of the station's faces is showing. `apps/android`'s `Tab`, in its order.
enum HomeTab: Hashable {
    case nowPlaying
    case upNext
    case whatsOn
    case settings
}

/// The station's faces, one tab each, every tab with its own navigation stack.
///
/// Tabs rather than links in Now playing's toolbar, as on Android: switching between them is not
/// leaving the screen, and a record page pushed from one tab is still there when the listener comes
/// back to it. Settings is a tab rather than a gear over every screen, because a gear above a list
/// of records said nothing about the records.
///
/// The player bar is over What's on only, as on Android: not over Now playing, which has the button
/// already, nor Up next, whose own on-air row says what is playing a thumb's width away, nor Settings,
/// which is not about what is on.
///
/// Up next and What's on are tabs whether or not anybody is signed in, and says what it needs when nobody is:
/// a tab that appeared on signing in would move every tab after it.
struct HomeTabs: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        // The explicit-closure setter, not the method passed straight in: see apps/ios/CLAUDE.md.
        TabView(selection: Binding(get: { model.tab }, set: { model.tab = $0 })) {
            NavigationStack { NowPlayingScreen().pageDestinations() }
                .tabItem { Label(String(localized: "Now playing"), systemImage: "radio") }
                .tag(HomeTab.nowPlaying)
            NavigationStack { UpNextScreen().pageDestinations() }
                .tabItem { Label(String(localized: "Up next"), systemImage: "list.bullet") }
                .tag(HomeTab.upNext)
            NavigationStack { WhatsOnScreen().miniPlayer().pageDestinations() }
                .tabItem { Label(String(localized: "What's on"), systemImage: "calendar") }
                .tag(HomeTab.whatsOn)
            // The explicit-closure setter: see apps/ios/CLAUDE.md.
            NavigationStack(path: Binding(get: { model.settingsPath }, set: { model.settingsPath = $0 })) { SettingsScreen().pageDestinations() }
                .tabItem { Label(String(localized: "Settings"), systemImage: "gearshape") }
                .tag(HomeTab.settings)
        }
    }
}
