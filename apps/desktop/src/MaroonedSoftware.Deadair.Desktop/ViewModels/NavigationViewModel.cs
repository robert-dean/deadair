using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Navigation;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One button on the sidebar.</summary>
public sealed partial class NavigationItemViewModel(NavigationEntry entry) : ObservableObject
{
    public NavigationEntry Entry { get; } = entry;

    public string Label => Entry.Label;

    public string Key => Entry.Key;

    /// <summary>The icon's resource key, which the view resolves.</summary>
    public string Icon => Entry.Icon;

    [ObservableProperty]
    private bool _isCurrent;

    [ObservableProperty]
    private bool _isVisible = true;
}

/// <summary>One heading in the sidebar, and what sits under it.</summary>
public sealed partial class NavigationSectionViewModel(string label, IReadOnlyList<NavigationItemViewModel> items)
    : ObservableObject
{
    public string Label { get; } = label;

    public IReadOnlyList<NavigationItemViewModel> Items { get; } = items;

    [ObservableProperty]
    private bool _isVisible = true;
}

/// <summary>
/// Where the app is, and how it gets somewhere else.
/// </summary>
/// <remarks>
/// The rail REPLACES rather than pushes: a rail is not history, so pressing Desk after Library does
/// not leave Library on a stack to come back to. A detail page PUSHES, because it is somewhere a page
/// led and Back should return to that page as it was left; the rail clears the stack, since pressing
/// it is starting somewhere new.
/// </remarks>
public sealed partial class NavigationViewModel : ObservableObject
{
    public NavigationViewModel()
    {
        foreach (var entry in Destinations.All)
        {
            Items.Add(new NavigationItemViewModel(entry));
        }

        Items[0].IsCurrent = true;

        // Built once and in the order the destinations are declared, so the sidebar and the keyboard
        // cannot end up disagreeing about what exists.
        Sections =
        [
            .. Items
                .GroupBy(item => item.Entry.Section)
                .Select(group => new NavigationSectionViewModel(Heading(group.Key), [.. group])),
        ];

        ApplyRole(isOperator: false);
    }

    /// <summary>
    /// Every destination, flat.
    /// </summary>
    /// <remarks>
    /// The keyboard reads this rather than the sections: a shortcut is about the whole app, and
    /// walking a grouping to find a letter would be walking a view's arrangement to answer a
    /// question that has nothing to do with it.
    /// </remarks>
    public ObservableCollection<NavigationItemViewModel> Items { get; } = [];

    /// <summary>The same destinations, under the headings the sidebar draws.</summary>
    public IReadOnlyList<NavigationSectionViewModel> Sections { get; }

    [ObservableProperty]
    private Destination _current = new Destination.Desk();

    public bool IsDesk => Current is Destination.Desk;

    public bool IsProgramme => Current is Destination.Programme;

    public bool IsLibrary => Current is Destination.Library;

    public bool IsHistory => Current is Destination.History;

    public bool IsCheckup => Current is Destination.Checkup;

    public bool IsSettings => Current is Destination.Settings;

    public bool IsVoice => Current is Destination.Voice;

    public event Action<Destination>? Navigated;

    /// <summary>Where Back goes, newest last.</summary>
    private readonly Stack<Destination> _back = new();

    /// <summary>Whether there is a page to go back to, which is only ever true on a detail page.</summary>
    public bool CanGoBack => _back.Count > 0;

    [RelayCommand]
    public void GoTo(NavigationItemViewModel item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Show(item.Entry.Destination);
    }

    /// <summary>
    /// Settings, for the macOS app menu, which cannot pass a sidebar item to <see cref="GoTo"/>.
    /// </summary>
    [RelayCommand]
    public void ShowSettings() => Show(new Destination.Settings());

    /// <summary>Goes somewhere from the rail, forgetting any trail of detail pages.</summary>
    public void Show(Destination destination)
    {
        _back.Clear();
        Arrive(destination);

        foreach (var item in Items)
        {
            item.IsCurrent = item.Entry.Destination == destination;
        }

        Navigated?.Invoke(destination);
    }

    /// <summary>Opens a detail page over the current one, which Back returns to.</summary>
    /// <remarks>
    /// The rail keeps pointing where it was: a chart is still somewhere in the Library, and a rail
    /// with nothing lit would be a rail that has lost track of where you are.
    /// </remarks>
    public void Push(Destination destination)
    {
        ArgumentNullException.ThrowIfNull(destination);
        _back.Push(Current);
        Arrive(destination);
        Navigated?.Invoke(destination);
    }

    /// <summary>Back to the page a detail page was opened from.</summary>
    [RelayCommand]
    public void Back()
    {
        if (!_back.TryPop(out var previous))
        {
            return;
        }

        Arrive(previous);
        Navigated?.Invoke(previous);
    }

    private void Arrive(Destination destination)
    {
        Current = destination;
        OnPropertyChanged(nameof(CanGoBack));

        OnPropertyChanged(nameof(IsDesk));
        OnPropertyChanged(nameof(IsProgramme));
        OnPropertyChanged(nameof(IsLibrary));
        OnPropertyChanged(nameof(IsHistory));
        OnPropertyChanged(nameof(IsCheckup));
        OnPropertyChanged(nameof(IsSettings));
        OnPropertyChanged(nameof(IsVoice));
    }

    /// <summary>
    /// Hides what an account cannot reach, and leaves a hidden page rather than staying on it.
    /// </summary>
    /// <remarks>
    /// Signing out while on an operator page would otherwise leave somebody looking at an empty
    /// screen with no way to tell why, so the rail sends them back to the desk — which is the one
    /// destination that works with no account at all.
    /// </remarks>
    public void ApplyRole(bool isOperator)
    {
        foreach (var item in Items)
        {
            item.IsVisible = !item.Entry.NeedsOperator || isOperator;
        }

        // A heading with nothing under it is a heading promising a section somebody cannot reach.
        foreach (var section in Sections)
        {
            section.IsVisible = section.Items.Any(item => item.IsVisible);
        }

        if (!isOperator && Items.Any(item => item is { IsCurrent: true, IsVisible: false }))
        {
            Show(new Destination.Desk());
        }
    }

    /// <remarks>
    /// The words rather than the enum's own: `Listen` and `App` are already sentences, and the desk
    /// is "The desk" everywhere else in this app.
    /// </remarks>
    private static string Heading(NavSection section) => section switch
    {
        NavSection.Listen => "LISTEN",
        NavSection.Desk => "DESK",
        _ => "APP",
    };
}
