import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// The request page's rules, which are the station's rules restated. `apps/android`'s
/// `RequestUiStateTest`, case for case.
///
/// Two of them are easy to get wrong at the screen: a blank field is a 400 if it is sent rather than
/// left out, and a refusal arrives as a 201, so the status and not the code decides what is said.
struct RequestUiStateTests {
    private let trackId = UUID(uuidString: "5B0E8A52-3C1F-4D2A-9E7B-0F6C1D2E3A4B")!

    private var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    private func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

    private func request(_ status: RequestStatus, reason: String? = nil, airedAt: String? = nil, dedicateTo: String? = nil) -> ListenerRequest {
        ListenerRequest(
            id: UUID(uuidString: "0C9F3E1A-7B2D-4E8F-A1C3-5D6E7F809A1B")!,
            status: status,
            title: "Blue Monday",
            artist: "New Order",
            requesterName: "a listener",
            source: .app,
            createdAt: date("2026-10-03T20:00:00Z"),
            reason: reason,
            airedAt: airedAt.map(date),
            dedicateTo: dedicateTo
        )
    }

    @Test func aRowCarriesAlbumAndYearWhenTheStationKnowsThem() throws {
        let row = try #require(RequestRow(RequestableTrack(trackId: trackId, title: "Blue Monday", artist: "New Order", album: "Power, Corruption & Lies", year: 1983)))
        #expect(row.trackId == trackId)
        #expect(row.detail == "Power, Corruption & Lies · 1983")
    }

    @Test func aRowWithNeitherAlbumNorYearHasNoDetailLine() {
        #expect(RequestRow(RequestableTrack(trackId: trackId, title: "Song", artist: "Band"))?.detail == nil)
        #expect(RequestRow(RequestableTrack(trackId: trackId, title: "Song", artist: "Band", year: 1983))?.detail == "1983")
    }

    @Test func blankFieldsAreLeftOutRatherThanSentEmpty() {
        let body = RequestForm(name: "  ", dedicateTo: "", message: "\n").body(for: held)
        #expect(body.trackId == trackId)
        #expect(body.source == nil)
        #expect(body.name == nil)
        #expect(body.dedicateTo == nil)
        #expect(body.message == nil)
    }

    @Test func fieldsAreSentTrimmedAndWithinTheStationsCaps() {
        let body = RequestForm(name: " Sam ", dedicateTo: String(repeating: "x", count: 80), message: String(repeating: "y", count: 250)).body(for: held)
        #expect(body.name == "Sam")
        #expect(body.dedicateTo?.count == RequestRules.dedicateMax)
        #expect(body.message?.count == RequestRules.messageMax)
    }

    private var held: RequestRow { RequestRow(RequestableTrack(trackId: trackId, title: "Song", artist: "Band"))! }

    @Test func aRecordOnlyAProviderCarriesIsAskedForByItsSourceAndSaysWhereFrom() throws {
        let source = RequestableSource(pluginId: "deadair.spotify", externalId: "sp-1")
        let row = try #require(RequestRow(RequestableTrack(source: source, sourceName: "Spotify", title: "Blueberry Hill", artist: "Fats Domino")))
        #expect(row.id == "deadair.spotify:sp-1")
        #expect(row.sourceName == "Spotify")
        let body = RequestForm().body(for: row)
        #expect(body.trackId == nil)
        #expect(body.source == source)
    }

    @Test func aRecordTheStationHoldsIsAskedForByItsIdAloneAndSaysNothingAboutWhereFrom() throws {
        let row = try #require(RequestRow(RequestableTrack(trackId: trackId, source: RequestableSource(pluginId: "deadair.spotify", externalId: "sp-1"), sourceName: "Spotify", title: "Song", artist: "Band")))
        #expect(row.sourceName == nil)
        #expect(RequestForm().body(for: row).source == nil)
    }

    @Test func aRowNamingItsRecordNeitherWayIsNotDrawn() {
        #expect(RequestRow(RequestableTrack(title: "Song", artist: "Band")) == nil)
    }

    @Test func aRefusalIsSaidInTheStationsWordsWhateverTheCodeWas() {
        let reason = "You already have a request in: Blue Monday. One at a time."
        #expect(RequestRules.outcome(request(.declined, reason: reason)) == .requestRefused(reason))
        #expect(RequestRules.outcome(request(.expired)) == .requestRefused(nil))
    }

    @Test func aRequestTheOperatorMustApproveSaysSo() {
        #expect(RequestRules.outcome(request(.waiting)) == .requestWaiting("Blue Monday"))
    }

    @Test func aRequestTheStationTookIsOnItsWay() {
        #expect(RequestRules.outcome(request(.pending)) == .requestOnItsWay("Blue Monday"))
        #expect(RequestRules.outcome(request(.queued)) == .requestOnItsWay("Blue Monday"))
    }

    @Test func onlyWaitingPendingAndQueuedAreOpen() {
        #expect(RequestStatus.allCases.filter(RequestRules.isOpen) == [.waiting, .pending, .queued])
    }

    @Test func anAiredRequestSaysWhenInTheListenersZone() {
        let row = MyRequestRow(request(.aired, airedAt: "2026-10-03T21:14:05Z"), now: date("2026-10-03T22:00:00Z"), calendar: utc)
        #expect(row.note == .aired(.today(Clock(hour: 21, minute: 14))))
    }

    @Test func aRefusedRequestSaysWhyAndAnOpenOneWhoItIsFor() {
        let now = date("2026-10-03T22:00:00Z")
        #expect(MyRequestRow(request(.declined, reason: "Not tonight."), now: now, calendar: utc).note == .text("Not tonight."))
        #expect(MyRequestRow(request(.queued, dedicateTo: "Alex"), now: now, calendar: utc).note == .requestFor("Alex"))
        #expect(MyRequestRow(request(.pending), now: now, calendar: utc).note == nil)
    }
}
