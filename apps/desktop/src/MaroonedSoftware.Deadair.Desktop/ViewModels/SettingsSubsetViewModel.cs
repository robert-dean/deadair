using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// A few of the station's settings, drawn on the page they are about rather than on Settings.
/// </summary>
/// <remarks>
/// <para>
/// The boundary rule under the timetable and the sustaining source are station settings, declared in
/// the station's registry because <c>PUT /settings</c> refuses a key nobody declared, and drawn by the
/// web console beside the timetable that makes sense of them. So this reads the whole declaration,
/// keeps the named keys in the order given, and draws them through the one shared form: the same
/// strings-only encoding and the same partial write as the Settings page, so a value somebody else
/// changed while this was open is not overwritten.
/// </para>
/// <para>
/// <see cref="Extra"/> is for a page that draws some of its own controls beside the form (the
/// sustaining source's picker): its values go out in the same write, so the two halves cannot land
/// separately.
/// </para>
/// </remarks>
public sealed partial class SettingsSubsetViewModel(OperatorActions actions, Func<DeadairSdk> sdk, IReadOnlyList<string> keys) : ObservableObject
{
    /// <summary>The form over the named keys, once the station has answered.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasForm))]
    private ConfigFormViewModel? _form;

    public bool HasForm => Form is not null;

    /// <summary>What happened on the last save, in a few words.</summary>
    [ObservableProperty]
    private string? _status;

    [ObservableProperty]
    private bool _busy;

    /// <summary>What the station holds for every key, including the ones this form does not draw.</summary>
    public IReadOnlyDictionary<string, JsonElement> Values { get; private set; } = new Dictionary<string, JsonElement>();

    /// <summary>Values a page adds to the next save from controls of its own. Null for none.</summary>
    public Func<IReadOnlyDictionary<string, JsonElement>>? Extra { get; set; }

    /// <summary>Raised after the station has answered a read or a save.</summary>
    public event Action? Presented;

    public async Task LoadAsync(CancellationToken cancellationToken)
    {
        var station = await actions.RunAsync(
            async token =>
            {
                using var client = sdk();
                return await client.Settings.GetSettingsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (station is not null)
        {
            Present(station);
        }
    }

    /// <summary>Draws the named keys out of what the station declared and holds.</summary>
    public void Present(StationSettings station)
    {
        ArgumentNullException.ThrowIfNull(station);

        var declared = station.Descriptors.ToDictionary(descriptor => descriptor.Key, StringComparer.Ordinal);
        Values = station.Values;
        Form = new ConfigFormViewModel(
            keys.Where(declared.ContainsKey).Select(key => FormField.From(declared[key])),
            station.Values,
            station.Configured,
            FormEncoding.Strings,
            station.Derived);
        Presented?.Invoke();
    }

    [RelayCommand]
    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        if (Form is null)
        {
            return;
        }

        if (Form.Problem() is { } problem)
        {
            Status = problem;
            return;
        }

        var changed = Form.Submission();
        foreach (var (key, value) in Extra?.Invoke() ?? new Dictionary<string, JsonElement>())
        {
            changed[key] = value;
        }

        if (changed.Count == 0)
        {
            Status = "Nothing has changed.";
            return;
        }

        Busy = true;
        Status = null;
        try
        {
            var saved = await actions.RunAsync(
                async token =>
                {
                    using var client = sdk();
                    return await client.Settings.UpdateSettingsAsync(new StationSettingsInput { Values = changed }, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (saved is null)
            {
                return;
            }

            Present(saved);
            Status = "Saved.";
        }
        finally
        {
            Busy = false;
        }
    }
}
