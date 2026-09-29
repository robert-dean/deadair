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
}
