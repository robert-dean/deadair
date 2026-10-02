@testable import DeadairCore
import DeadairSdk
import Testing

/// The two small decisions behind a rating. `apps/android`'s `RatingSelectionTest` and `LikeToggleTest`.
struct RatingTests {
    @Test func neutralAndAbsentBothDrawAsNothingPressed() {
        #expect(ratingSelection(nil) == nil)
        #expect(ratingSelection(.neutral) == nil)
        #expect(ratingSelection(.liked) == .liked)
        #expect(ratingSelection(.disliked) == .disliked)
    }

    @Test func theHeartGoesIntoAndOutOfLikedAndNowhereElse() {
        #expect(toggledLike(.liked) == .neutral)
        #expect(toggledLike(.neutral) == .liked)
        #expect(toggledLike(nil) == .liked)
        // A record the operator had disliked is liked by the heart, never disliked further.
        #expect(toggledLike(.disliked) == .liked)
    }
}
