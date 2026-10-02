import DeadairSdk
import Foundation
import Observation

/// Something the operator should be told about an action, named rather than worded so the words
/// live with the rest of the app's copy. `apps/android`'s `Notice`, case for case.
public enum Notice: Equatable, Sendable {
    /// The station answered 403: the cached role was wrong, and has been re-read.
    case noLongerOperator

    /// The station answered 403 asking for the account to be proved again, not refusing it.
    ///
    /// The opposite state to `noLongerOperator`, and the roles are deliberately NOT re-read: the
    /// account holds the permission, and what is missing is a recent second factor rather than a
    /// role. Re-reading would confirm `admin` and change nothing, having spent a request to do it.
    case stepUpNeeded

    /// Start on a station that was never put on air. There is nothing to resume.
    case nothingToResume

    /// Airing a playlist with no tracks the station can play.
    case playlistEmpty

    /// A persona picked from a list the station has since changed. The list is stale, not the choice.
    case hostGone

    /// A record picked from a list the catalog has since lost, or that no provider offers a copy of any more.
    case recordGone

    /// A record the station will not put on now: its audio is not here yet, its own rules veto it,
    /// or the position asked for has already been handed to the player. One 422 for all of them.
    case recordRefused

    /// The station could not be reached to ask.
    case couldNotReach

    /// The station refused for a reason this app has no sentence for. Carries the status for the
    /// operator's eyes.
    case failed(status: Int)
}

/// Something said to whoever is holding the phone, and which one it is, so the same words said
/// twice are shown twice.
public struct Toast: Equatable, Sendable {
    public let id: Int
    public let message: Message
}

/// What the app has to say about something somebody just did, one thing at a time.
///
/// **Posted to the whole app.** Android lost a notice raised on a pushed screen because its
/// collector lived on a screen that was not composed; here the toast is drawn above the navigation
/// stack, so whichever screen raised it, it is on top of what the reader is looking at.
@MainActor
@Observable
public final class Toasts {
    /// What is being said, until it is dismissed or replaced.
    public private(set) var current: Toast?

    @ObservationIgnored private var said = 0

    public init() {}

    public func say(_ message: Message) {
        said += 1
        current = Toast(id: said, message: message)
    }

    /// The toast has been read, or its time is up. A newer one is left standing.
    public func dismiss(_ id: Int) {
        if current?.id == id { current = nil }
    }
}

/// How every `platform.manage` call from the phone is made.
///
/// One path for all of them so one rule holds everywhere: **the API is the gate and the cached role
/// is a hint.** A control is drawn because the last `GET /auth/session` said `admin`; the station
/// may have changed its mind since, and a 403 here is how the phone finds out. It re-reads the
/// roles, which redraws the screen without the controls, and says so once, rather than leaving a
/// button that fails silently on every press.
///
/// Failures come out as a `Notice` on the app's `Toasts` rather than as errors at the call site,
/// because every call site would otherwise catch the same three things and show the same message.
/// `apps/android`'s `OperatorActions`.
@MainActor
public final class OperatorActions {
    private let session: OperatorSession
    private let toasts: Toasts

    public init(session: OperatorSession, toasts: Toasts) {
        self.session = session
        self.toasts = toasts
    }

    /// Make one call. Answers what the station answered, or `nil` after posting a notice.
    ///
    /// `expected` names the statuses that mean something in particular for this action (a 409 from
    /// Start is "nothing to resume", not a fault), and everything else the station refuses is
    /// reported with its number.
    public func run<T: Sendable>(expected: [Int: Notice] = [:], _ action: @escaping @Sendable (Deadair) async throws -> T) async -> T? {
        do {
            return try await session.withSession(action)
        } catch let error as SdkError where error.status != 0 {
            // Before the plain 403, because it IS one: reading them as a single case is what tells an
            // operator they are no longer the operator while they still are.
            if error.isStepUpRequired {
                post(.stepUpNeeded)
            } else if error.status == 403 {
                try? await session.refreshRoles()
                post(.noLongerOperator)
            } else if let meant = expected[error.status] {
                post(meant)
            } else {
                post(.failed(status: error.status))
            }
            return nil
        } catch is NotSignedIn {
            // The session ended under the press. The screen is already redrawing without the control.
            return nil
        } catch is CancellationError {
            // The screen went away. Nobody is there to be told.
            return nil
        } catch {
            post(.couldNotReach)
            return nil
        }
    }

    private func post(_ notice: Notice) {
        toasts.say(.operatorNotice(notice))
    }
}

/// How the policy renders a step-up denial in the body it sends everybody.
let stepUpRequired = "step_up_required"

/// The 403 that is asking for a second factor rather than refusing outright, as `WWW-Authenticate` names it.
let mfaRequired = "mfa_required"

/// Whether a refusal is asking for a second factor rather than saying no.
///
/// Two spellings of the same thing and both are read, because the station sends both and neither is
/// guaranteed to survive the trip: `details.kind` is the policy's own rendering, and the
/// `WWW-Authenticate` challenge is the copy it exposes through CORS for a browser's benefit.
///
/// Told apart from a plain 403 because they are opposite states. A plain one means the account does
/// not hold the permission and retrying is pointless; this one means it does, and the station wants
/// the account proved again first.
public func namesStepUp(body: Data, challenge: String?) -> Bool {
    struct Denial: Decodable {
        struct Details: Decodable { let kind: String? }
        let details: Details?
    }
    let kind = (try? JSONDecoder().decode(Denial.self, from: body))?.details?.kind
    return kind == stepUpRequired || authError(inChallenge: challenge) == mfaRequired
}

extension SdkError {
    /// Whether this refusal wants a second factor. False for every status but 403.
    public var isStepUpRequired: Bool {
        status == 403 && namesStepUp(body: body, challenge: headers["www-authenticate"] ?? headers["WWW-Authenticate"])
    }
}
