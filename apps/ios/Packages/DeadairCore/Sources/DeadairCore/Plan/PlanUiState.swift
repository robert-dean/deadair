import DeadairSdk
import Foundation

/// Whether this stays the same show.
///
/// The one axis the two station commands differ on. `ReplanStationInput` is a strict subset of
/// `PutOnAirInput`, so making it two forms would encode the question as which of two controls you
/// tapped; it is asked outright instead, and the scope decides which fields EXIST rather than which
/// are greyed out.
public enum PlanScope: Equatable, Sendable {
    case keep, new
}

/// What the operator has typed. Held as text where the field is text, so a half-typed year is representable.
public struct PlanForm: Equatable, Sendable {
    public var brief = ""
    public var personaId: String?
    public var eraFrom = ""
    public var eraTo = ""
    public var mode: StationMode = .rotation
    public var onEnd: StationOnEnd = .extend
    public var callins = false

    public init(brief: String = "", personaId: String? = nil, eraFrom: String = "", eraTo: String = "", mode: StationMode = .rotation, onEnd: StationOnEnd = .extend, callins: Bool = false) {
        self.brief = brief
        self.personaId = personaId
        self.eraFrom = eraFrom
        self.eraTo = eraTo
        self.mode = mode
        self.onEnd = onEnd
        self.callins = callins
    }
}

/// Planning the station: replan this show, or start a new one.
///
/// Pure, because the interesting decisions are all about what to SEND. The one worth the most care is
/// the brief on a replan: absent keeps whatever the broadcast carries, an empty string CLEARS it, and
/// a string replaces it; three cases behind one text field, and the difference between the first two
/// is whether the operator touched the box. `apps/android`'s `PlanUiState`.
public struct PlanUiState: Equatable, Sendable {
    /// What the station accepts, and what the console's own field allowed.
    public static let briefMax = 500
    /// The years a period may name. A record whose year the catalogue does not know plays whatever the period.
    public static let eraYears = 1900...2100

    public let scope: PlanScope
    public let form: PlanForm
    /// What the broadcast is already asked to play, which is what an unchanged field must not rewrite.
    public let currentBrief: String?
    /// Whether there is a show to keep. Off air there is not, and the question is not a question.
    public let somethingOn: Bool

    public init(scope: PlanScope, form: PlanForm, currentBrief: String?, somethingOn: Bool) {
        self.scope = scope
        self.form = form
        self.currentBrief = currentBrief
        self.somethingOn = somethingOn
    }

    public var showsScope: Bool { somethingOn }

    public var keeping: Bool { scope == .keep && somethingOn }

    /// Starting a new show over a running one is heard by everybody within a record, and says so.
    public var warnsReplacing: Bool { !keeping && somethingOn }

    public var fromYear: Int? { year(form.eraFrom) }

    public var toYear: Int? { year(form.eraTo) }

    public var eraFromError: Message? {
        fromYear.flatMap { Self.eraYears.contains($0) ? nil : .eraOutOfRange }
    }

    /// The end of the period carries the backwards error as well as its own range. It is the field
    /// somebody typed second, so it is the one they meant to change.
    public var eraToError: Message? {
        if let to = toYear, !Self.eraYears.contains(to) { return .eraOutOfRange }
        if let from = fromYear, let to = toYear, from > to { return .eraBackwards }
        return nil
    }

    private var eraReady: Bool {
        eraFromError == nil && eraToError == nil && !incomplete(form.eraFrom) && !incomplete(form.eraTo)
    }

    /// Replanning is always allowed: asking the station to programme the same stretch again against
    /// the same words is a real thing to want. Starting a show needs words, because they are what it
    /// is programmed against and what it is called.
    public var canSubmit: Bool {
        keeping ? true : nonBlank(form.brief) != nil && eraReady
    }

    /// Absent keeps the brief, an empty string clears it, a string replaces it. Both sides are trimmed
    /// before they are compared, so a stored brief with a stray space is not rewritten into itself by a
    /// field nobody touched. `count` is never sent: the station's own answer of roughly an hour is what
    /// a phone means by a replan.
    public func replanInput() -> ReplanStationInput {
        let asked = trimmed(form.brief)
        return asked == trimmed(currentBrief ?? "") ? ReplanStationInput() : ReplanStationInput(brief: asked)
    }

    /// A new broadcast, built from words rather than from a playlist or a chart. The brief doubles as
    /// the name. Everything optional is sent only when it was chosen: an absent host is whichever
    /// persona the station has on air, an absent period is no bound, and absent phone-ins are none.
    public func putOnAirInput() -> PutOnAirInput {
        let asked = trimmed(form.brief)
        return PutOnAirInput(
            name: asked, brief: asked, personaId: form.personaId, eraFrom: fromYear, eraTo: toYear,
            callins: form.callins ? true : nil, mode: form.mode, onEnd: form.onEnd
        )
    }

    private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func year(_ text: String) -> Int? {
        let digits = trimmed(text)
        return digits.count == 4 ? Int(digits) : nil
    }

    /// A year still being typed: not an error to shout about, but not something to send either.
    private func incomplete(_ text: String) -> Bool {
        let digits = trimmed(text)
        return !digits.isEmpty && digits.count < 4
    }
}
