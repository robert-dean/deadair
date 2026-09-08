namespace MaroonedSoftware.Deadair.Desktop.PluginSdk;

/// <summary>
/// What the app gives a plugin, and the whole of it.
/// </summary>
/// <remarks>
/// Handed to <see cref="IDeadairPlugin.InitializeAsync"/> and valid until the plugin is disposed. An
/// operator saving configuration disposes the instance and builds a new one, so a host reference
/// kept across an await outlives what it points at; capture what is needed instead.
/// </remarks>
public interface IPluginHost
{
    /// <summary>The plugin's own id, as its manifest declares it. Useful in a log line.</summary>
    string PluginId { get; }

    IPluginLogger Logger { get; }

    /// <summary>
    /// The plugin's OWN client, not the station's.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The app is otherwise strict about having exactly one <see cref="HttpClient"/>, because the
    /// station counts a listener by address and User-Agent and a second client is a second listener.
    /// That argument does not reach here and its opposite does: a plugin talks to a box on the local
    /// network, which is a different listener by design and must never be handed the station's
    /// bearer token or its session handler.
    /// </para>
    /// <para>
    /// <b>Its timeout is infinite, deliberately, and every request must carry its own deadline.</b>
    /// A client's timeout cannot be changed after its first request, and a plugin that long-polls a
    /// device needs a longer wait than any single number would serve. Use a linked
    /// <see cref="CancellationTokenSource"/> per request.
    /// </para>
    /// </remarks>
    HttpClient Http { get; }

    /// <summary>
    /// Every declared configuration field, as a string.
    /// </summary>
    /// <remarks>
    /// A setting is text at every layer of this station, so an on/off field arrives as the word
    /// <c>true</c> and a number as its digits. Declared defaults are already applied; a field with
    /// neither a value nor a default is ABSENT rather than empty, so a plugin can tell "left blank"
    /// from "set to nothing".
    /// </remarks>
    IReadOnlyDictionary<string, string> Config { get; }

    /// <summary>The clock, so a plugin's timing can be tested without waiting.</summary>
    TimeProvider Clock { get; }

    /// <summary>
    /// Cancelled when this instance is going away, whether because the app is closing or because an
    /// operator changed the plugin's configuration.
    /// </summary>
    CancellationToken Shutdown { get; }
}
