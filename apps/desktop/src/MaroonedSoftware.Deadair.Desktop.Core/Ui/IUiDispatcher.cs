namespace MaroonedSoftware.Deadair.Desktop.Core.Ui;

/// <summary>
/// Getting back onto the thread a view can be touched from.
/// </summary>
/// <remarks>
/// The seam that keeps this project free of Avalonia. Repositories poll on the thread pool and raise
/// their events there; the application implements this with the UI thread's dispatcher, and a test
/// implements it by running the callback where it stands.
/// </remarks>
public interface IUiDispatcher
{
    void Post(Action action);
}

/// <summary>Runs the callback on the calling thread. For tests, and for headless hosts.</summary>
public sealed class ImmediateUiDispatcher : IUiDispatcher
{
    public static ImmediateUiDispatcher Instance { get; } = new();

    public void Post(Action action)
    {
        ArgumentNullException.ThrowIfNull(action);
        action();
    }
}
