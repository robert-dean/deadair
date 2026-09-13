using System.Net;
using System.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Updates;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class UpdateCheckerTests
{
    [Fact]
    public async Task SendsTheAppsOwnUserAgent_BecauseGitHubRefusesARequestWithout()
    {
        var github = new Answering(HttpStatusCode.OK, "[]");
        using var http = new HttpClient(github);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("deadair-desktop/0.1.0");

        await new UpdateChecker(http, new Version(0, 1, 0)).CheckAsync(TestContext.Current.CancellationToken);

        Assert.Equal("deadair-desktop/0.1.0", github.UserAgent);
        Assert.Equal(UpdateCheck.Endpoint, github.Asked);
    }

    [Fact]
    public async Task FindsANewerRelease()
    {
        using var http = new HttpClient(new Answering(HttpStatusCode.OK, """[ { "ref": "refs/tags/desktop-v0.3.0" } ]"""));

        var found = await new UpdateChecker(http, new Version(0, 1, 0)).CheckAsync(TestContext.Current.CancellationToken);

        Assert.Equal(new Version(0, 3, 0), found?.Version);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task AnswersNothingRatherThanThrowingWhenGitHubRefuses(HttpStatusCode status)
    {
        using var http = new HttpClient(new Answering(status, """{ "message": "no" }"""));

        Assert.Null(await new UpdateChecker(http, new Version(0, 1, 0)).CheckAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task AnswersNothingRatherThanThrowingOnRubbish()
    {
        using var http = new HttpClient(new Answering(HttpStatusCode.OK, "<html>a captive portal</html>"));

        Assert.Null(await new UpdateChecker(http, new Version(0, 1, 0)).CheckAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task AnswersNothingRatherThanThrowingWithNoNetwork()
    {
        using var http = new HttpClient(new Unreachable());

        Assert.Null(await new UpdateChecker(http, new Version(0, 1, 0)).CheckAsync(TestContext.Current.CancellationToken));
    }

    private sealed class Answering(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public string? UserAgent { get; private set; }

        public Uri? Asked { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            UserAgent = request.Headers.UserAgent.ToString();
            Asked = request.RequestUri;

            return Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
        }
    }

    private sealed class Unreachable : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("No route to host");
    }
}
