namespace MaroonedSoftware.Deadair.Desktop.Core.Net;

/// <summary>
/// Puts <see cref="UserAgent.Value"/> on every request.
/// </summary>
/// <remarks>
/// Overwritten rather than filled in when absent, because the whole point is that there is exactly
/// one: a caller that set its own would be a second listener as far as the station's audience count
/// is concerned.
/// </remarks>
public sealed class UserAgentHandler : DelegatingHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        request.Headers.UserAgent.Clear();
        request.Headers.TryAddWithoutValidation("User-Agent", UserAgent.Value);

        return base.SendAsync(request, cancellationToken);
    }
}
