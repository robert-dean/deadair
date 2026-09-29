using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Microsoft.Extensions.Time.Testing;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// How a question over the app is asked and answered, and where a refusal is said.
/// </summary>
/// <remarks>
/// A dialog is the thing between an operator and the station's most consequential calls, so its
/// answers must be exactly "yes" and "no": a dialog that closed on a failed save would be one that
/// reported success, and one that stacked would be asking two things at once.
/// </remarks>
public class DialogsTests
{
    private static (DialogsViewModel Dialogs, OperatorActions Actions, FakeTimeProvider Time) Build()
    {
        var actions = new OperatorActions(new SessionManager(new InMemorySecretStore(), new HttpClient(new FakeTransport())));
        var time = new FakeTimeProvider();
        return (new DialogsViewModel(actions, ImmediateUiDispatcher.Instance, time), actions, time);
    }

    private sealed class Saving(Func<Task<bool>> save) : DialogViewModel
    {
        public override string Title => "Save?";

        public override Task<bool> AcceptAsync(CancellationToken cancellationToken) => save();
    }

    [Fact]
    public async Task AcceptingAnswersYesAndCloses()
    {
        var (dialogs, _, _) = Build();

        var answer = dialogs.ConfirmAsync("Delete it?", "It does not come back.", "Delete");
        await dialogs.AcceptCommand.ExecuteAsync(null);

        Assert.True(await answer);
        Assert.False(dialogs.IsOpen);
    }

    [Fact]
    public async Task CancellingAnswersNo()
    {
        var (dialogs, _, _) = Build();

        var answer = dialogs.ConfirmAsync("Delete it?", "It does not come back.", "Delete");
        dialogs.Cancel();

        Assert.False(await answer);
        Assert.False(dialogs.IsOpen);
    }

    [Fact]
    public async Task ASecondQuestionAnswersTheFirstNo()
    {
        var (dialogs, _, _) = Build();

        var first = dialogs.ConfirmAsync("One?", "One.", "One");
        _ = dialogs.ConfirmAsync("Two?", "Two.", "Two");

        Assert.False(await first);
        Assert.Equal("Two?", dialogs.Current!.Title);
    }

    [Fact]
    public async Task ASaveThatFailsLeavesTheDialogOpen()
    {
        // Closing on a failed save would be the dialog reporting success.
        var (dialogs, _, _) = Build();

        var answer = dialogs.ShowAsync(new Saving(() => Task.FromResult(false)));
        await dialogs.AcceptCommand.ExecuteAsync(null);

        Assert.True(dialogs.IsOpen);
        Assert.False(answer.IsCompleted);
    }

    [Fact]
    public async Task ARefusalWhileSavingIsSaidOnTheDialog()
    {
        var (dialogs, actions, _) = Build();

        var dialog = new Saving(async () =>
            await actions.DoAsync(_ => throw new SdkException(409, "{}", message: "That name is taken.")));
        _ = dialogs.ShowAsync(dialog);

        await dialogs.AcceptCommand.ExecuteAsync(null);

        Assert.NotNull(dialog.Problem);
        Assert.Null(dialogs.Notice);
    }

    [Fact]
    public async Task ARefusalWithNoDialogIsSaidOnThePageAndGoesOnItsOwn()
    {
        var (dialogs, actions, time) = Build();

        await actions.DoAsync(
            _ => throw new SdkException(422, "{}"),
            new Dictionary<int, string> { [422] = "There is nothing on that playlist the station can play." },
            TestContext.Current.CancellationToken);

        Assert.Equal("There is nothing on that playlist the station can play.", dialogs.Notice);

        time.Advance(TimeSpan.FromSeconds(9));

        Assert.Null(dialogs.Notice);
    }

    [Fact]
    public async Task ACallWithNoAnswerSaysWhetherItWorked()
    {
        var (_, actions, _) = Build();

        var token = TestContext.Current.CancellationToken;

        Assert.True(await actions.DoAsync(_ => Task.CompletedTask, cancellationToken: token));
        Assert.False(await actions.DoAsync(_ => throw new SdkException(500, "{}"), cancellationToken: token));
    }
}
