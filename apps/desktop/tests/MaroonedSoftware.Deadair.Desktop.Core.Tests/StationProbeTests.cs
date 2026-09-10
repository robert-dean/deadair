using System.Security.Authentication;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What a probe answers when something goes wrong beneath the HTTP call, rather than in the
/// response itself.
/// </summary>
public class StationProbeTests
{
    private const string Origin = "https://radio.example.com";

    [Fact]
    public async Task ATlsCertificateThisMacDoesNotTrustAnswersUntrusted()
    {
        var probe = ProbeThrowing(new HttpRequestException("the certificate is not trusted", new AuthenticationException("not trusted")));

        var reading = await probe.ProbeAsync(Station(), TestContext.Current.CancellationToken);

        Assert.Equal(StationProbeResult.Untrusted, reading.Result);
    }

    [Fact]
    public async Task APlainHttpRequestExceptionStillAnswersUnreachable()
    {
        // Not every `HttpRequestException` is a certificate problem: a refused connection or a DNS
        // failure carries no `AuthenticationException` inside it, and those still mean nothing
        // answered.
        var probe = ProbeThrowing(new HttpRequestException("connection refused"));

        var reading = await probe.ProbeAsync(Station(), TestContext.Current.CancellationToken);

        Assert.Equal(StationProbeResult.Unreachable, reading.Result);
    }

    private static StationUrl Station()
    {
        Assert.True(StationUrl.TryParse(Origin, out var station));
        return station;
    }

    private static StationProbe ProbeThrowing(Exception exception) =>
        new(new HttpClient(new ThrowingHandler(exception)));

    /// <summary>A transport that never reaches the wire: every request fails the same way.</summary>
    private sealed class ThrowingHandler(Exception exception) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw exception;
    }
}
