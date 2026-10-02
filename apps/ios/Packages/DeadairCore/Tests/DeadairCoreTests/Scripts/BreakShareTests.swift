@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// Which breaks can be sent, what the file is called, and what is said when it fails.
/// `apps/android`'s `BreakShareTest`, case for case.
struct BreakShareTests {
    private func attempt(outcome: ScriptOutcome = .written, segmentId: String? = "seg-1") -> ScriptAttempt {
        ScriptAttempt(id: "a", at: Date(timeIntervalSince1970: 0), kind: "link", writer: "model", outcome: outcome, script: "Hello.", segmentId: segmentId)
    }

    @Test func onlyAWrittenBreakWhoseSegmentIsStillKnownCanBeShared() {
        #expect(BreakShare.shareable(attempt()))
        #expect(!BreakShare.shareable(attempt(segmentId: nil)))
        #expect(!BreakShare.shareable(attempt(outcome: .declined)))
        #expect(!BreakShare.shareable(attempt(outcome: .failed)))
    }

    @Test func theFileTakesTheNameTheStationOffered() {
        #expect(BreakShare.fileName(contentDisposition: #"attachment; filename="deadair-top-of-the-hour.m4a""#, extension: "m4a") == "deadair-top-of-the-hour.m4a")
    }

    @Test func aNameThatWouldEscapeTheDirectoryIsCleanedRatherThanTrusted() {
        #expect(BreakShare.fileName(contentDisposition: #"attachment; filename="../../deadair-sneaky.m4a""#, extension: "m4a") == "deadair-sneaky.m4a")
    }

    @Test func withNoNameOfferedOrNothingUsableTheCopyGetsOneOfItsOwn() {
        #expect(BreakShare.fileName(contentDisposition: nil, extension: "m4a") == BreakShare.fallbackName)
        #expect(BreakShare.fileName(contentDisposition: "attachment", extension: "m4a") == BreakShare.fallbackName)
        #expect(BreakShare.fileName(contentDisposition: #"attachment; filename="///""#, extension: "m4a") == BreakShare.fallbackName)
    }

    @Test func theExtensionFollowsTheTypeTheStationActuallySent() {
        #expect(BreakShare.fileName(contentDisposition: nil, extension: "wav") == "deadair-break.wav")
    }

    @Test func eachWayOfNotGettingACopySaysSomethingDifferent() {
        #expect(BreakShare.failure(status: nil) == .shareCouldNotReach)
        #expect(BreakShare.failure(status: 404) == .shareGone)
        #expect(BreakShare.failure(status: 503) == .shareCannotCopy)
        #expect(BreakShare.failure(status: 502) == .shareFailed)
    }

    @Test func anOlderStationsOriginalIsStillSentUnderItsOwnType() {
        let headers = GetSegmentAudio200Headers(cacheControl: nil, etag: nil, contentDisposition: nil)
        #expect(BreakShare.received(.status200AudioWav(data: Data([1]), headers: headers))?.extension == "wav")
        #expect(BreakShare.received(.status200AudioMp4(data: Data([1]), headers: headers))?.extension == "m4a")
        #expect(BreakShare.received(.status304) == nil)
    }
}
