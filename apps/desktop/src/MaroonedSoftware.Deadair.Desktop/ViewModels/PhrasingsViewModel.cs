using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// What the station says around a greeting, a jingle, a change of show, a bulletin, the weather and the
/// date, whenever no model writes the words.
/// </summary>
/// <remarks>
/// <para>
/// The station's `phrasings` settings group, which no section of Settings draws, so it is drawn here
/// and only here, through the one shared form. A talk break's phrasings are not among them: they belong
/// to the character saying them, on its own sheet.
/// </para>
/// <para>
/// The switches these depend on (whether the station welcomes anybody at all) are on Settings, and a
/// box whose switch is elsewhere is shown rather than hidden: a box that vanishes gives no hint where
/// its switch is.
/// </para>
/// </remarks>
public sealed partial class PhrasingsViewModel(OperatorActions actions, HttpClient http) : VoiceTabViewModel(actions, http)
{
    /// <summary>The group's fields as a form, or null until the station has said what it holds.</summary>
    [ObservableProperty]
    private ConfigFormViewModel? _form;

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var settings = await RunAsync((sdk, token) => sdk.Settings.GetSettingsAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (settings is not null)
        {
            Present(settings);
        }
    }

    public void Present(StationSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        // Every value travels as a string, as every station setting does.
        Form = new ConfigFormViewModel(
            settings.Descriptors.Where(descriptor => descriptor.Group == SettingGroup.Phrasings).Select(FormField.From),
            settings.Values,
            settings.Configured,
            FormEncoding.Strings,
            settings.Derived);
    }

    /// <summary>Only what changed is sent, so a box somebody else edited meanwhile is left as they left it.</summary>
    [RelayCommand]
    private async Task SaveAsync()
    {
        if (Form is not { } form)
        {
            return;
        }

        if (form.Problem() is { } problem)
        {
            Notice = problem;
            return;
        }

        var changed = form.Submission();
        if (changed.Count == 0)
        {
            Notice = "Nothing has changed.";
            return;
        }

        var saved = await RunAsync((sdk, token) => sdk.Settings.UpdateSettingsAsync(new StationSettingsInput { Values = changed }, token))
            .ConfigureAwait(true);
        if (saved is not null)
        {
            Notice = changed.Count == 1 ? "Saved one set of phrasings." : $"Saved {changed.Count} sets of phrasings.";
            Present(saved);
        }
    }
}
