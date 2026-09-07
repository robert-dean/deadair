using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Navigation;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One button on the rail.</summary>
public sealed partial class NavigationItemViewModel(NavigationEntry entry) : ObservableObject
{
    public NavigationEntry Entry { get; } = entry;

    public string Label => Entry.Label;

    public string Key => Entry.Key;

    [ObservableProperty]
    private bool _isCurrent;

    [ObservableProperty]
    private bool _isVisible = true;
}

/// <summary>
/// Where the app is, and how it gets somewhere else.
/// </summary>
/// <remarks>
/// The rail REPLACES rather than pushes: a rail is not history, so pressing Desk after Library does
/// not leave Library on a stack to come back to. Detail pages, when they exist, will push.
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
    }

    public ObservableCollection<NavigationItemViewModel> Items { get; } = [];

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

    [RelayCommand]
    public void GoTo(NavigationItemViewModel item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Show(item.Entry.Destination);
    }

    public void Show(Destination destination)
    {
        Current = destination;

        foreach (var item in Items)
        {
            item.IsCurrent = item.Entry.Destination == destination;
        }

        OnPropertyChanged(nameof(IsDesk));
        OnPropertyChanged(nameof(IsProgramme));
        OnPropertyChanged(nameof(IsLibrary));
        OnPropertyChanged(nameof(IsHistory));
        OnPropertyChanged(nameof(IsCheckup));
        OnPropertyChanged(nameof(IsSettings));
        OnPropertyChanged(nameof(IsVoice));

        Navigated?.Invoke(destination);
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

        if (!isOperator && Items.Any(item => item is { IsCurrent: true, IsVisible: false }))
        {
            Show(new Destination.Desk());
        }
    }
}
