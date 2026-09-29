using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Services;
using Nav = MaroonedSoftware.Deadair.Desktop.Navigation;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>Which part of the voice page is showing.</summary>
public enum VoiceTab
{
    Characters,
    Segments,
    Productions,
    Said,
}

/// <summary>
/// Who the station is when it talks, and everything it needs to say it.
/// </summary>
/// <remarks>
/// <para>
/// The web console's tabs, in its order: who is talking, then everything they need to talk. An operator
/// does not arrive wanting "the pronunciations page"; they arrive because the station said a name
/// wrong, and every answer to "why did it sound like that" is on this one destination.
/// </para>
/// <para>
/// Each tab is its own view model, owned here, attached with the station and read when it is shown.
/// This one only knows which is showing.
/// </para>
/// </remarks>
public sealed partial class VoiceViewModel : ObservableObject
{
    public VoiceViewModel(
        OperatorActions actions,
        HttpClient http,
        IDialogs dialogs,
        PreviewsViewModel previews,
        IFilePicker files,
        NavigationViewModel navigation)
    {
        ArgumentNullException.ThrowIfNull(navigation);

        Characters = new CharactersViewModel(actions, http, dialogs, previews, files, navigation);
        Segments = new SegmentsViewModel(actions, http, previews);
        Productions = new ProductionsViewModel(actions, http, dialogs);
        Scripts = new ScriptsViewModel(actions, http);

        // Anything a tab keeps running (a poll while something is being made) stops when the page is
        // left. A character's own page counts as staying: it is somewhere this page led.
        navigation.Navigated += destination =>
        {
            if (destination is not (Nav.Destination.Voice or Nav.Destination.PersonaDetail))
            {
                foreach (var tab in Tabs)
                {
                    tab.Leave();
                }
            }
        };
    }

    public CharactersViewModel Characters { get; }

    public SegmentsViewModel Segments { get; }

    public ProductionsViewModel Productions { get; }

    /// <summary>What it said.</summary>
    public ScriptsViewModel Scripts { get; }

    private IEnumerable<VoiceTabViewModel> Tabs => [Characters, Segments, Productions, Scripts];

    [ObservableProperty]
    private VoiceTab _tab = VoiceTab.Characters;

    public bool IsCharacters => Tab == VoiceTab.Characters;

    public bool IsSaid => Tab == VoiceTab.Said;

    public bool IsSegments => Tab == VoiceTab.Segments;

    public bool IsProductions => Tab == VoiceTab.Productions;

    /// <summary>The tab showing.</summary>
    public VoiceTabViewModel Current => Tab switch
    {
        VoiceTab.Segments => Segments,
        VoiceTab.Productions => Productions,
        VoiceTab.Said => Scripts,
        _ => Characters,
    };

    public void Attach(StationUrl station)
    {
        foreach (var tab in Tabs)
        {
            tab.Attach(station);
        }
    }

    partial void OnTabChanged(VoiceTab oldValue, VoiceTab newValue)
    {
        OnPropertyChanged(nameof(IsCharacters));
        OnPropertyChanged(nameof(IsSaid));
        OnPropertyChanged(nameof(IsSegments));
        OnPropertyChanged(nameof(IsProductions));
        OnPropertyChanged(nameof(Current));

        TabFor(oldValue).Leave();
        _ = Current.LoadAsync(CancellationToken.None);
    }

    [RelayCommand]
    private void ShowTab(string tab)
    {
        if (Enum.TryParse<VoiceTab>(tab, out var parsed))
        {
            Tab = parsed;
        }
    }

    /// <summary>Reads the tab showing. Every visit reads it again, since what the station says moves.</summary>
    [RelayCommand]
    private Task LoadAsync(CancellationToken cancellationToken) => Current.LoadAsync(cancellationToken);

    private VoiceTabViewModel TabFor(VoiceTab tab) => tab switch
    {
        VoiceTab.Segments => Segments,
        VoiceTab.Productions => Productions,
        VoiceTab.Said => Scripts,
        _ => Characters,
    };
}
