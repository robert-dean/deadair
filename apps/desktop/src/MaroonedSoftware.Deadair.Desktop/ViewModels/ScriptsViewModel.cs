using System.Collections.ObjectModel;
using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One thing the station tried to say.</summary>
public sealed record ScriptRowViewModel(string When, string Kind, string Writer, string Text, StatusTone Tone);

/// <summary>
/// What the station said, or tried to: one row per ATTEMPT rather than per segment.
/// </summary>
/// <remarks>
/// That is the point of the endpoint: a model that declined and the floor that covered for it are two
/// facts, and one row would hide the more interesting of them.
/// </remarks>
public sealed partial class ScriptsViewModel(OperatorActions actions, HttpClient http) : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<ScriptRowViewModel> Scripts { get; } = [];

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var page = await RunAsync(
            (sdk, token) => sdk.Render.ReadScriptHistoryAsync(new ScriptHistoryQuery { Limit = 60 }, token),
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return;
        }

        Scripts.Clear();
        foreach (var attempt in page.Attempts)
        {
            Scripts.Add(new ScriptRowViewModel(
                attempt.At.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture),
                attempt.Kind,
                attempt.Writer,
                attempt.Script ?? attempt.Reason ?? "(nothing was written)",
                attempt.Outcome switch
                {
                    ScriptOutcome.Written => StatusTone.Ok,
                    ScriptOutcome.Declined => StatusTone.Standby,
                    _ => StatusTone.Fault,
                }));
        }
    }
}
