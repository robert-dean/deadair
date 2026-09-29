using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// What every section of Settings reaches the station with: the one client, the one path refusals
/// take, the one place a question is asked, and the system's file panels.
/// </summary>
/// <remarks>
/// One object handed to each section rather than four constructor parameters on each of a dozen,
/// and the station is read from it at call time: Settings outlives a change of station, and a section
/// that captured the address when it was built would go on asking the old one.
/// </remarks>
public sealed class SettingsCalls(OperatorActions actions, HttpClient http, IDialogs dialogs, IFilePicker? files, ISystemShell? shell = null)
{
    public OperatorActions Actions { get; } = actions;

    public IDialogs Dialogs { get; } = dialogs;

    /// <summary>The open and save panels, absent in a headless render where there is no window to hang them off.</summary>
    public IFilePicker? Files { get; } = files;

    /// <summary>The browser and the clipboard, absent in a headless render.</summary>
    public ISystemShell? Shell { get; } = shell;

    public StationUrl Station { get; set; }

    public DeadairSdk Sdk() => new(new SdkOptions { BaseUrl = Station.ApiBase, HttpClient = http });

    /// <summary>
    /// Reads what a card shows, answering <c>Forbidden</c> rather than a notice when this account may
    /// not see it, so the card can hide itself as the console's do.
    /// </summary>
    /// <remarks>
    /// A card about somebody else's business (the station's registered apps, say) is simply absent
    /// for an account that may not read it; a line at the foot of the page saying "no longer an
    /// operator" would be wrong, since they may still be one. Any other refusal is reported as usual.
    /// </remarks>
    public async Task<(T? Value, bool Forbidden)> ReadAsync<T>(Func<DeadairSdk, CancellationToken, Task<T>> read, CancellationToken cancellationToken)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(read);

        try
        {
            using var sdk = Sdk();
            return (await read(sdk, cancellationToken).ConfigureAwait(true), false);
        }
        catch (SdkException failure) when (ApiError.IsForbidden(failure))
        {
            return (null, true);
        }
        catch (SdkException failure)
        {
            // Through the one path, so it is said the way every other refusal is.
            return (await Actions.RunAsync(_ => Task.FromException<T>(failure), cancellationToken: cancellationToken).ConfigureAwait(true), false);
        }
    }
}
