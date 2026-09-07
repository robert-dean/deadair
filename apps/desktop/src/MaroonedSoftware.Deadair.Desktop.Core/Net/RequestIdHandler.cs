using System.Globalization;

namespace MaroonedSoftware.Deadair.Desktop.Core.Net;

/// <summary>
/// Gives every request an <c>X-Request-ID</c>, as the station's other SDKs do.
/// </summary>
/// <remarks>
/// The station logs it, so a line in the operator's log and a line in this app's can be matched up.
/// Set only when absent, so a caller that has a correlation id of its own keeps it — the opposite of
/// the User-Agent rule next door, and for the opposite reason: this one identifies a request rather
/// than the client.
/// </remarks>
public sealed class RequestIdHandler : DelegatingHandler
{
    private const string Header = "X-Request-ID";

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!request.Headers.Contains(Header))
        {
            request.Headers.TryAddWithoutValidation(
                Header,
                Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture));
        }

        return base.SendAsync(request, cancellationToken);
    }
}
