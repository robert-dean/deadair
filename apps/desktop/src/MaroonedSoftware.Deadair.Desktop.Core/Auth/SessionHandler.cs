using System.Net;
using System.Net.Http.Headers;

namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>
/// Attaches the bearer, and turns one rejected token into one retry.
/// </summary>
/// <remarks>
/// <para>
/// On the shared client rather than in the SDK, so that every request in the app — the SDK's, the
/// artwork loader's, anything added later — goes through the same refresh. The SDK is deliberately
/// built with no header callback of its own for this reason.
/// </para>
/// <para>
/// <b>The token endpoints are exempt.</b> A 401 from the refresh itself is the session ending, and
/// refreshing in response to it would be an infinite loop; a 401 from sign-in is a wrong password.
/// </para>
/// </remarks>
public sealed class SessionHandler(Func<SessionManager?> session) : DelegatingHandler
{
    private static readonly string[] Exempt = ["/auth/token", "/auth/logout"];

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var manager = session();
        if (manager is null || IsExempt(request))
        {
            return await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }

        var token = manager.AccessToken;
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        // Buffered BEFORE sending, because a replay needs the body again and a stream that has been
        // read once cannot be. Every request the SDK makes is a string or a small form, so this costs
        // nothing worth measuring.
        if (request.Content is not null)
        {
            await request.Content.LoadIntoBufferAsync(cancellationToken).ConfigureAwait(false);
        }

        var response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);

        if (response.StatusCode != HttpStatusCode.Unauthorized || token is null)
        {
            return response;
        }

        var refreshed = await manager.RefreshedAsync(token, cancellationToken).ConfigureAwait(false);
        if (refreshed is not RefreshOutcome.Renewed renewed)
        {
            // Either the session ended, in which case the caller's 401 is the truth and the app routes
            // to sign-in, or the station could not be asked — and handing back the refresh's own
            // failure instead would be a confusing lie about what the caller asked for.
            return response;
        }

        response.Dispose();

        // ONCE. A second 401 after a fresh token is not a token problem, and retrying past this point
        // is how a client hammers a station that is telling it something true.
        using var replay = Clone(request, renewed.AccessToken);
        return await base.SendAsync(replay, cancellationToken).ConfigureAwait(false);
    }

    private static bool IsExempt(HttpRequestMessage request)
    {
        var path = request.RequestUri?.AbsolutePath;
        if (path is null)
        {
            return false;
        }

        foreach (var exempt in Exempt)
        {
            if (path.EndsWith(exempt, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static HttpRequestMessage Clone(HttpRequestMessage request, string token)
    {
        var replay = new HttpRequestMessage(request.Method, request.RequestUri)
        {
            Version = request.Version,
            VersionPolicy = request.VersionPolicy,
            Content = request.Content,
        };

        foreach (var header in request.Headers)
        {
            if (!string.Equals(header.Key, "Authorization", StringComparison.OrdinalIgnoreCase))
            {
                replay.Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
        }

        replay.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        foreach (var option in request.Options)
        {
            replay.Options.TryAdd(option.Key, option.Value);
        }

        return replay;
    }
}
