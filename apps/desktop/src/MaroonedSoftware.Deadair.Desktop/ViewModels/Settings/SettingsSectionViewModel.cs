using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>What a section's contents can say about themselves to the list: whether anything in them is unsaved.</summary>
public interface ISettingsSectionContent : INotifyPropertyChanged
{
    bool IsDirty { get; }

    /// <summary>Asked each time the section is shown, so a reading is fresh where it is cheap to make it so.</summary>
    void Shown();
}

/// <summary>One entry in the Settings page's list of sections, and what it opens.</summary>
/// <remarks>
/// The contents are built once and kept for the page's life, which is what keeps an unsaved edit in
/// one section while somebody looks at another: every section saves on its own, so leaving one is not
/// a reason to throw away what was typed in it.
/// </remarks>
public sealed partial class SettingsSectionViewModel : ObservableObject
{
    public SettingsSectionViewModel(SettingsSection section, object content)
    {
        ArgumentNullException.ThrowIfNull(section);
        ArgumentNullException.ThrowIfNull(content);

        Section = section;
        Content = content;

        if (content is ISettingsSectionContent tracked)
        {
            tracked.PropertyChanged += (_, e) =>
            {
                if (e.PropertyName == nameof(ISettingsSectionContent.IsDirty))
                {
                    OnPropertyChanged(nameof(IsDirty));
                }
            };
        }
    }

    public SettingsSection Section { get; }

    public SettingsSectionId Id => Section.Id;

    public string Label => Section.Label;

    public string Hint => Section.Hint;

    /// <summary>The view model the page draws for this section.</summary>
    public object Content { get; }

    /// <summary>Whether it holds an edit nobody has saved, marked in the list so it is not forgotten.</summary>
    public bool IsDirty => Content is ISettingsSectionContent { IsDirty: true };

    [ObservableProperty]
    private bool _isActive;
}
