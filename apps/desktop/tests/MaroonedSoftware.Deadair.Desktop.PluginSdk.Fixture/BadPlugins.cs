namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Fixture;

/// <summary>
/// A plugin whose start fails, which is the ordinary way for a real one to fail.
/// </summary>
/// <remarks>
/// A device plugin handed an address that answers nothing does roughly this. What the test cares
/// about is that the message reaches the operator instead of the app.
/// </remarks>
public sealed class ThrowsOnInitPlugin : IDeadairPlugin
{
    /// <summary>The words the test looks for.</summary>
    public const string Complaint = "there is no speaker at that address";

    public Task InitializeAsync(IPluginHost host, CancellationToken cancellationToken) =>
        throw new InvalidOperationException(Complaint);

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

/// <summary>
/// A plugin that never returns from start.
/// </summary>
/// <remarks>
/// Not malice: a discovery that waits for a device to answer, on a network where nothing will. The
/// host bounds it, because the alternative is an app that never finishes starting because of a
/// plugin nobody is currently using.
/// </remarks>
public sealed class HangsOnInitPlugin : IDeadairPlugin
{
    public Task InitializeAsync(IPluginHost host, CancellationToken cancellationToken) =>
        Task.Delay(Timeout.Infinite, cancellationToken);

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

/// <summary>
/// Declares the output capability in its manifest and does not implement it.
/// </summary>
/// <remarks>
/// The mismatch a manifest and a class can drift into, since one is JSON and the other is code. It
/// is caught at load rather than when the picker asks for devices and gets nothing back.
/// </remarks>
public sealed class SaysItCanPlayButCannotPlugin : IDeadairPlugin
{
    public Task InitializeAsync(IPluginHost host, CancellationToken cancellationToken) => Task.CompletedTask;

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

/// <summary>A class the manifest can name that is not a plugin at all.</summary>
public sealed class NotAPlugin;
