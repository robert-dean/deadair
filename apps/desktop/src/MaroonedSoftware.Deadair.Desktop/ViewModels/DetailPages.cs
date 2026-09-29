using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;

// The destination types live in a namespace that shares its name with a property elsewhere.
using Nav = MaroonedSoftware.Deadair.Desktop.Navigation;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// Builds the view model for a detail page, once per visit.
/// </summary>
/// <remarks>
/// <para>
/// The rail's pages are singletons because there is one of each. A detail page is one of many (a
/// chart, an artist), so its view model is made when it is opened and let go when it is left, and
/// this is the one place that knows how.
/// </para>
/// <para>
/// A view model that is opened is also read: a detail page is somewhere somebody went to look at a
/// thing, and one that waited for a second press to fetch it would be a page that opens empty.
/// </para>
/// </remarks>
public sealed class DetailPages(OperatorActions actions, HttpClient http, LibraryViewModel library, SettingsViewModel? settings = null)
{
    private StationUrl _station;

    public void Attach(StationUrl station) => _station = station;

    /// <summary>What the page for this destination is showing, or null for a rail page.</summary>
    public object? Current { get; private set; }

    /// <summary>Builds and reads the page for a detail destination, and forgets the last one.</summary>
    public void Open(Nav.Destination destination)
    {
        // A page left behind stops whatever it was waiting on (a plugin's sign-in, say): nobody is
        // looking at it any more.
        (Current as IDisposable)?.Dispose();

        Current = destination switch
        {
            Nav.Destination.ChartDetail chart => Chart(chart),
            Nav.Destination.PluginDetail plugin => settings?.OpenPlugin(plugin.Id, plugin.Name),
            _ => null,
        };
    }

    private ChartDetailViewModel Chart(Nav.Destination.ChartDetail chart)
    {
        var row = library.Charts.Charts.FirstOrDefault(each => each.Id == chart.Id)
            ?? new ChartRowViewModel(chart.Id, chart.Name, string.Empty);

        var page = new ChartDetailViewModel(actions, http, _station, row, library.Charts.PlayCommand);
        page.LoadCommand.Execute(null);
        return page;
    }
}
