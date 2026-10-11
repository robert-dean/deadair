@testable import DeadairCore
import Testing

/// Which way round Now playing goes, and when it may rest. Sizes are the safe-area sizes the page
/// is laid out in, in points.
struct NowPlayingLayoutTests {
    @Test func anUprightPhoneRunsTheCoverTheWidth() {
        #expect(NowPlayingLayout(width: 402, height: 791) == .fullBleed)
        #expect(NowPlayingLayout(width: 375, height: 647) == .fullBleed)
    }

    @Test func aPhoneOnItsSidePutsTheCoverBesideTheWords() {
        #expect(NowPlayingLayout(width: 750, height: 381) == .sideBySide)
        // An iPhone SE on its side, with no notch to inset.
        #expect(NowPlayingLayout(width: 667, height: 354) == .sideBySide)
    }

    @Test func anIpadPutsTheCoverBesideTheWordsEitherWayUp() {
        #expect(NowPlayingLayout(width: 820, height: 1106) == .sideBySide)
        #expect(NowPlayingLayout(width: 1180, height: 746) == .sideBySide)
    }

    @Test func aNarrowIpadWindowIsLaidOutAsAPhone() {
        #expect(NowPlayingLayout(width: 320, height: 1106) == .fullBleed)
        #expect(NowPlayingLayout(width: 599, height: 1106) == .fullBleed)
        #expect(NowPlayingLayout(width: 600, height: 1106) == .sideBySide)
    }

    @Test func aSquareIsUpright() {
        #expect(NowPlayingLayout(width: 500, height: 500) == .fullBleed)
    }

    @Test func restsOnlyUpright() {
        #expect(NowPlayingLayout.fullBleed.rests(canRest: true))
        #expect(!NowPlayingLayout.sideBySide.rests(canRest: true))
        #expect(!NowPlayingLayout.fullBleed.rests(canRest: false))
        #expect(!NowPlayingLayout.sideBySide.rests(canRest: false))
    }
}
