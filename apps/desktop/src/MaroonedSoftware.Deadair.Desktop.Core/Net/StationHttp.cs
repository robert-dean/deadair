namespace MaroonedSoftware.Deadair.Desktop.Core.Net;

/// <summary>
/// The one <see cref="HttpClient"/> everything in the app goes through.
/// </summary>
/// <remarks>
/// <para>
/// <b>One client, not one per concern.</b> The station counts an HLS listener by IP and User-Agent,
/// so an app whose API calls, artwork fetches and audio all present differently is counted as
/// several listeners, and one that sends no agent at all is counted as whatever the platform's
/// default is that release. Putting the agent on a handler here means a new caller cannot forget it.
/// </para>
/// <para>
/// The SDK is handed this client and told not to dispose it, and is given NO header callback of its
/// own: the bearer goes on in a handler too, so that the refresh and its single replay live in one
/// place rather than beside every call.
/// </para>
/// </remarks>
public static class StationHttp
{
    /// <summary>
    /// Long enough for a station under load and short enough that a wrong address fails while somebody
    /// is still looking at the screen.
    /// </summary>
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);

    /// <summary>
    /// Builds the client.
    /// </summary>
    /// <param name="session">
    /// The handler that attaches the bearer and performs the single-flight refresh, when there is
    /// one. Null before sign-in exists, which is every phase up to the one that adds it.
    /// </param>
    public static HttpClient Create(DelegatingHandler? session = null)
    {
        var transport = new SocketsHttpHandler
        {
            // The station is one host and the app talks to it constantly. Pooling is what keeps a
            // two-second poll from being a TLS handshake every two seconds.
            PooledConnectionLifetime = TimeSpan.FromMinutes(10),
            ConnectTimeout = TimeSpan.FromSeconds(10),
            AutomaticDecompression = System.Net.DecompressionMethods.All,
        };

        DelegatingHandler outermost = new UserAgentHandler();
        DelegatingHandler requestId = new RequestIdHandler();

        outermost.InnerHandler = requestId;

        if (session is not null)
        {
            requestId.InnerHandler = session;
            session.InnerHandler = transport;
        }
        else
        {
            requestId.InnerHandler = transport;
        }

        return new HttpClient(outermost, disposeHandler: true)
        {
            Timeout = RequestTimeout,
        };
    }
}
