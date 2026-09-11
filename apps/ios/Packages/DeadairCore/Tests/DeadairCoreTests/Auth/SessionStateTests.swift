@testable import DeadairCore
import Testing

/// Whether a stored session counts for the station the app is pointed at.
struct SessionStateTests {
    @Test func aSessionForThisStationIsSignedIn() {
        #expect(sessionFor(signedIn(), station: station()) == .signedIn(email: "operator@example.com", roles: []))
    }

    @Test func aSessionForADifferentStationIsNot() {
        #expect(sessionFor(signedIn(), station: station("https://elsewhere.example.com")) == .signedOut)
    }

    @Test func theSameHostOnADifferentSchemeIsADifferentStation() {
        #expect(sessionFor(signedIn(), station: station("http://radio.example.com")) == .signedOut)
    }

    @Test func carriesTheRolesTheStationReported() {
        #expect(sessionFor(signedIn(roles: [.admin]), station: station()) == .signedIn(email: "operator@example.com", roles: [.admin]))
    }

    @Test func onlyAnAdminOperatesTheStation() {
        #expect(sessionFor(signedIn(roles: [.admin]), station: station()).isOperator)
        #expect(!sessionFor(signedIn(roles: [.listener]), station: station()).isOperator)
        #expect(!sessionFor(signedIn(), station: station()).isOperator)
    }

    @Test func noSessionIsSignedOut() {
        #expect(sessionFor(nil, station: station()) == .signedOut)
    }

    @Test func noStationIsSignedOutWhateverIsOnDisk() {
        #expect(sessionFor(signedIn(), station: nil) == .signedOut)
    }
}
