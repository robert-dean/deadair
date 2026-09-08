namespace MaroonedSoftware.Deadair.Desktop.PluginSdk;

/// <summary>
/// The type a plugin's manifest names, and the whole of what the host requires of it.
/// </summary>
/// <remarks>
/// <para>
/// It must be public, concrete, and have a public parameterless constructor: the host builds it with
/// <c>Activator.CreateInstance</c> and then calls <see cref="InitializeAsync"/>. Everything the
/// plugin needs arrives on the host rather than through the constructor, so that constructing and
/// starting are two moments and a plugin that fails to start can still be named on a settings page.
/// </para>
/// <para>
/// Capabilities are declared in the manifest and implemented as separate interfaces on this same
/// object. A declared capability the instance does not implement is a load failure, not a surprise
/// later.
/// </para>
/// <para>
/// <b>Do not hold the host across an await you did not start.</b> The host is released when the
/// plugin is disposed, and an operator saving configuration disposes and rebuilds the instance, so
/// work still in flight at that moment comes back to a host that is gone. Capture what is needed at
/// the top of a method.
/// </para>
/// </remarks>
public interface IDeadairPlugin : IAsyncDisposable
{
    /// <summary>
    /// Start. Configuration is on the host; nothing is expected to work before this is called.
    /// </summary>
    /// <remarks>
    /// Bounded by the host, which treats a plugin that never returns as a failed one. Anything
    /// thrown here quarantines the plugin with the exception's message shown to the operator, so a
    /// message naming what is missing is worth more than a stack.
    /// </remarks>
    Task InitializeAsync(IPluginHost host, CancellationToken cancellationToken);
}
