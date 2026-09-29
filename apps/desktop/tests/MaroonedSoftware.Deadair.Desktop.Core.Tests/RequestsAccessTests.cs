using System.Net;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The requests list is manage-only even to read, and a refusal to read it is not a failure.
/// </summary>
/// <remarks>
/// Every other 403 in this app refreshes the roles and says "no longer an operator" at the foot of
/// the page. Said here, that would tell somebody who never had the role that they had lost it; the
/// web console shows its own sentence in place of the list, and so does this.
/// </remarks>
public class RequestsAccessTests
{
    [Fact]
    public async Task AForbiddenListShowsTheSentence_AndReportsNothing()
    {
        var (requests, notices) = Build(HttpStatusCode.Forbidden);

        await requests.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Equal(Requests.Forbidden, requests.Forbidden);
        Assert.Empty(requests.Rows);
        Assert.Null(requests.Empty);
        Assert.Empty(notices);
    }

    [Fact]
    public async Task AnyOtherRefusalIsReportedAsOne()
    {
        var (requests, notices) = Build(HttpStatusCode.InternalServerError);

        await requests.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Null(requests.Forbidden);
        Assert.Single(notices);
    }

    private static (RequestsViewModel Requests, List<Notice> Notices) Build(HttpStatusCode status)
    {
        var station = new HttpClient(new Answers(status));
        var actions = new OperatorActions(new SessionManager(new InMemorySecretStore(), new HttpClient(new FakeTransport())));
        var notices = new List<Notice>();
        actions.Noticed += notices.Add;

        var requests = new RequestsViewModel(
            actions,
            () => new DeadairSdk(new SdkOptions { BaseUrl = "https://radio.example.com/api", HttpClient = station }),
            new NoDialogs());

        return (requests, notices);
    }

    private sealed class Answers(HttpStatusCode status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status));
    }

    private sealed class NoDialogs : IDialogs
    {
        public Task<bool> ShowAsync(DialogViewModel dialog) => Task.FromResult(false);

        public Task<bool> ConfirmAsync(string question, string consequence, string verb, bool destructive = true) => Task.FromResult(false);
    }
}
