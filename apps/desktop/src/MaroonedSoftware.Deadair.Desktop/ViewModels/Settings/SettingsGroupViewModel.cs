using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One declared group of the station's settings, as its own form with its own Save.
/// </summary>
/// <remarks>
/// <para>
/// The console's <c>SettingsGroupPage</c>. The write is partial, so a group knows nothing about the
/// others and cannot clear them; that was true when every group shared one form and one Save, and now
/// nothing about the page suggests otherwise.
/// </para>
/// <para>
/// A save answers with every setting the station holds, and the page hands that to every group. A
/// group with an unsaved edit keeps its form rather than taking the fresh values, because the fresh
/// values would overwrite what was typed; the one that saved takes them whatever it held.
/// </para>
/// </remarks>
public sealed partial class SettingsGroupViewModel(SettingsSection section, SettingsCalls calls, Action<SettingsGroupViewModel, StationSettings> saved)
    : ObservableObject, ISettingsSectionContent
{
    private IReadOnlyDictionary<ConfigFieldOptionSource, IReadOnlyList<ConfigFieldOption>>? _offered;

    public SettingsSection Section { get; } = section;

    public string Title => Section.Label;

    public string? Blurb => Section.Blurb;

    /// <summary>The button says which group it saves, because it saves that group and nothing else.</summary>
    public string SaveLabel => $"Save {Section.Label.ToLowerInvariant()}";

    /// <summary>The form over this group's fields, absent until the settings have been read.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsDirty), nameof(IsEmpty), nameof(HasForm))]
    private ConfigFormViewModel? _form;

    public bool HasForm => Form is { Fields.Count: > 0 };

    /// <summary>
    /// Read, and nothing in it. A group whose settings have not been built yet, said rather than drawn
    /// as a heading over nothing, which would invite somebody to look for them.
    /// </summary>
    public bool IsEmpty => Form is { Fields.Count: 0 };

    public bool IsDirty => Form?.IsDirty == true;

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _notice;

    /// <summary>Draws the group from a reading of every setting, unless it holds an edit and was not told to drop it.</summary>
    public void Present(StationSettings settings, bool force)
    {
        ArgumentNullException.ThrowIfNull(settings);

        if (!force && IsDirty)
        {
            return;
        }

        if (Form is { } old)
        {
            old.PropertyChanged -= OnFormChanged;
        }

        // Every value travels as a string: every layer of the station's configuration holds text, so
        // a JSON boolean would be a shape it does not store.
        var form = new ConfigFormViewModel(
            SettingsSections.Fields(settings, Section.Group!.Value).Select(FormField.From),
            settings.Values,
            settings.Configured,
            FormEncoding.Strings,
            settings.Derived);

        if (_offered is { } offered)
        {
            form.Offer(offered);
        }

        form.PropertyChanged += OnFormChanged;
        Form = form;
    }

    /// <summary>Hands the form the choices resolved for the live sources it names, and keeps them for the next form.</summary>
    public void Offer(IReadOnlyDictionary<ConfigFieldOptionSource, IReadOnlyList<ConfigFieldOption>> resolved)
    {
        _offered = resolved;
        Form?.Offer(resolved);
    }

    /// <summary>Forgets the station this was read from.</summary>
    public void Reset()
    {
        if (Form is { } old)
        {
            old.PropertyChanged -= OnFormChanged;
        }

        Form = null;
        _offered = null;
        Notice = null;
    }

    public void Shown()
    {
    }

    private void OnFormChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ConfigFormViewModel.IsDirty))
        {
            OnPropertyChanged(nameof(IsDirty));
            Notice = null;
        }
    }

    [RelayCommand]
    private async Task SaveAsync(CancellationToken cancellationToken)
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

        Busy = true;
        try
        {
            var answer = await calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = calls.Sdk();

                    // Partial: sending everything back would overwrite a value somebody else changed
                    // while this page was open.
                    return await sdk.Settings.UpdateSettingsAsync(new StationSettingsInput { Values = changed }, token)
                        .ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (answer is null)
            {
                return;
            }

            Present(answer, force: true);
            saved(this, answer);
            Notice = changed.Count == 1 ? "Saved one setting." : $"Saved {changed.Count} settings.";
        }
        finally
        {
            Busy = false;
        }
    }
}
