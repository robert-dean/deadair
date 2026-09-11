/// Cancels whatever it was returned from scheduling.
public typealias Cancel = @MainActor () -> Void

/// Run something after a delay, on the main actor, unless cancelled first.
///
/// Injected rather than called, which is what lets the timing decisions in this package be tested
/// on a clock the test moves by hand. `apps/android` injects its `schedule` for the same reason.
public typealias Schedule = @MainActor (Duration, @escaping @MainActor () -> Void) -> Cancel

public enum Scheduling {
    /// The real one: a task that sleeps and then runs.
    public static let tasks: Schedule = { delay, run in
        let task = Task { @MainActor in
            try? await Task.sleep(for: delay)
            if !Task.isCancelled { run() }
        }
        return { task.cancel() }
    }
}
