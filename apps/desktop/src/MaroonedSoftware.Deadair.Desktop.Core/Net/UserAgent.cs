namespace MaroonedSoftware.Deadair.Desktop.Core.Net;

/// <summary>
/// The one User-Agent, put on every request by the client rather than by each caller.
/// </summary>
/// <remarks>
/// HLS listeners are counted per IP and agent from playlist re-fetches, so an app that sends two
/// agents is two listeners and one that sends none is whatever the platform's default happens to be
/// that release. It goes on in a handler on the shared client, which a new caller cannot forget, and
/// the SAME string is handed to the player so the audio connection agrees with the API and the
/// artwork.
/// </remarks>
public static class UserAgent
{
    /// <summary>Named after the app and its version, so a station's logs can tell this client apart.</summary>
    public const string Value = "deadair-desktop/0.1.0";
}
