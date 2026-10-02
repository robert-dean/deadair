import DeadairSdk
import Foundation

/// How an attempt reads. A decline is standby rather than a fault, and that is the whole point of
/// the page: a model that declined and let the floor write is the registry working as designed.
/// Only a failed attempt, where something threw, is worth looking for.
public enum ScriptTone: Equatable, Sendable {
    case ok, standby, fault
}

/// What a fact in an attempt's detail is called.
public enum ScriptFactLabel: Equatable, Sendable {
    case kind, host, model, from, took, tokens, after, before, note
}

/// A labelled fact in an attempt's detail. The value is the station's own word, shown as it came.
public struct ScriptFact: Equatable, Sendable {
    public let label: ScriptFactLabel
    public let value: String
}

/// One attempt, as its row draws it. `apps/android`'s `ScriptRowUiState`.
public struct ScriptRowUiState: Equatable, Sendable {
    public let attempt: ScriptAttempt

    public init(_ attempt: ScriptAttempt) {
        self.attempt = attempt
    }

    public var tone: ScriptTone {
        switch attempt.outcome {
        case .written: .ok
        case .declined: .standby
        case .failed: .fault
        }
    }

    /// The words, or for an attempt that produced none, the reason, which takes the line the words would have.
    public var line: String { attempt.script ?? attempt.reason ?? "" }

    /// Whether the line is the reason standing in for words, and is drawn dimmer for it.
    public var lineIsReason: Bool { attempt.script == nil }

    /// A rating is asked for only where there are words to have an opinion about.
    public var rateable: Bool { attempt.script != nil }

    /// Absent stays absent, and is NOT neutral. Most attempts have never been read back, and drawing
    /// them as deliberately-no-opinion would make an unreviewed history look like a reviewed one.
    public var rating: ScriptRating? { attempt.rating }

    public var writer: Message { .writer(attempt.writer) }

    /// Everything about the attempt that is not the sentence it produced, in the console's order.
    public var facts: [ScriptFact] {
        var out = [ScriptFact(label: .kind, value: attempt.kind)]
        if let host = attempt.personaKey { out.append(ScriptFact(label: .host, value: host)) }
        if let model = attempt.model { out.append(ScriptFact(label: .model, value: model)) }
        if let source = attempt.source { out.append(ScriptFact(label: .from, value: source)) }
        // Half away from zero, as Android's formatter rounds: `%.1f` alone rounds 1.25 s to "1.2".
        if let took = attempt.durationMs { out.append(ScriptFact(label: .took, value: String(format: "%.1f s", (Double(took) / 100).rounded() / 10))) }
        if let tokens = attempt.usage?.totalTokens ?? attempt.usage?.outputTokens { out.append(ScriptFact(label: .tokens, value: String(tokens))) }
        if let previous = attempt.previous { out.append(ScriptFact(label: .after, value: neighbour(previous))) }
        if let next = attempt.next { out.append(ScriptFact(label: .before, value: neighbour(next))) }
        // Shown for a written attempt too: a model that produced words and a reason produced both.
        if let reason = attempt.reason, attempt.script != nil { out.append(ScriptFact(label: .note, value: reason)) }
        return out
    }

    private func neighbour(_ track: ScriptNeighbour) -> String { "\(track.title) — \(track.artist)" }
}

/// The operator's opinion of something the station said. Nothing acts on it yet; it is kept.
/// `apps/android`'s `ScriptActions`.
@MainActor
public final class ScriptActions {
    private let actions: OperatorActions

    public init(actions: OperatorActions) {
        self.actions = actions
    }

    /// The attempt as the station now has it, or `nil` after a notice.
    public func rate(_ attemptId: String, _ rating: ScriptRating) async -> ScriptAttempt? {
        guard let id = UUID(uuidString: attemptId) else { return nil }
        return await actions.run { try await $0.render.rateScript(id: id, body: ScriptRatingInput(rating: rating)) }
    }
}
