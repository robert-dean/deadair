using System.Text.RegularExpressions;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Station;

/// <summary>A page of this app that something needing a person can be sent to.</summary>
/// <remarks>
/// Core's own list rather than the app's destinations, which live beside Avalonia; the app turns each
/// into its destination in one switch.
/// </remarks>
public enum AttentionPage
{
    Desk,
    Programme,
    Library,
    Voice,
    Checkup,
    Settings,
}

/// <summary>How many things want somebody on a page, and how bad the worst of them is.</summary>
public readonly record struct AttentionCount(int Count, Severity Worst);

/// <summary>
/// Where each thing the station says needs a person can be dealt with, in this app.
/// </summary>
/// <remarks>
/// <para>
/// The station names the console page it thinks can fix a thing (<c>/personas</c>, <c>/onair</c>),
/// and those were the web console's pages when it learned the names. Rather than teach the API this
/// app's navigation, the translation lives here, as the web console's own does
/// (<c>attention.destination.ts</c>), and the table is the same one.
/// </para>
/// <para>
/// <b>An unknown route has no page rather than a wrong one.</b> A path from the station is a string,
/// so anything not matched keeps its sentence and loses its link, and the list says so. It counts
/// against no sidebar entry either: a badge on one page for a row that links nowhere would be two
/// answers to one question.
/// </para>
/// <para>
/// <b>One table, two readers.</b> The desk's list links each row with it and the sidebar counts its
/// badges from it, so a badge pointing at one page while its row links to another is not a state this
/// app can reach.
/// </para>
/// </remarks>
public static partial class AttentionRoutes
{
    /// <summary>The page a route can be dealt with on, or null when this app has none.</summary>
    public static AttentionPage? PageOf(string? route)
    {
        if (string.IsNullOrWhiteSpace(route))
        {
            return null;
        }

        // A plugin's own page, and the list of them, are both in Settings here, where the station's
        // plugins are configured.
        if (PluginPage().IsMatch(route))
        {
            return AttentionPage.Settings;
        }

        // One record, which is what a row's evidence points at, and the Tracks list narrowed to a
        // state. Both are the Library, which opens on its records.
        if (TrackPage().IsMatch(route) || route.StartsWith("/catalog?", StringComparison.Ordinal))
        {
            return AttentionPage.Library;
        }

        return route switch
        {
            // The station still names `/onair` for anything about the broadcast, which is the desk.
            "/onair" or "/" => AttentionPage.Desk,

            // A persona is a character on Voice.
            "/personas" => AttentionPage.Voice,
            "/schedule" => AttentionPage.Programme,
            "/catalog" => AttentionPage.Library,
            "/plugins" or "/settings" => AttentionPage.Settings,
            "/checkup" => AttentionPage.Checkup,
            _ => null,
        };
    }

    /// <summary>What a row's link is called: where it goes, named as the sidebar names it.</summary>
    /// <remarks>
    /// The DESTINATION rather than a remedy. The station sends a route and no verb, so a button
    /// reading "Reconnect Spotify" would be this app inventing a claim about what the click does.
    /// </remarks>
    public static string Label(AttentionPage page) => page switch
    {
        AttentionPage.Desk => "Desk",
        AttentionPage.Programme => "Programme",
        AttentionPage.Library => "Library",
        AttentionPage.Voice => "Voice",
        AttentionPage.Checkup => "Check-up",
        _ => "Settings",
    };

    /// <summary>
    /// The station's severity in this app's vocabulary.
    /// </summary>
    /// <remarks>
    /// Written out rather than matched by name, because the activity feed uses different words for
    /// the same idea and a mapping that relied on the names lining up would break silently.
    /// </remarks>
    public static Severity SeverityOf(AttentionItemSeverity severity) => severity switch
    {
        AttentionItemSeverity.Failure => Severity.Failure,
        AttentionItemSeverity.Warning => Severity.Warning,
        _ => Severity.Notice,
    };

    /// <summary>Which page each item counts against, and the worst severity there.</summary>
    public static IReadOnlyDictionary<AttentionPage, AttentionCount> Counts(IEnumerable<AttentionItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);

        var counts = new Dictionary<AttentionPage, AttentionCount>();

        foreach (var item in items)
        {
            if (PageOf(item.Route) is not { } page)
            {
                continue;
            }

            var severity = SeverityOf(item.Severity);

            // Severity is declared worst first, so the smaller value is the worse one.
            counts[page] = counts.TryGetValue(page, out var existing)
                ? new AttentionCount(existing.Count + 1, existing.Worst <= severity ? existing.Worst : severity)
                : new AttentionCount(1, severity);
        }

        return counts;
    }

    [GeneratedRegex("^/plugins/.+$", RegexOptions.CultureInvariant)]
    private static partial Regex PluginPage();

    [GeneratedRegex("^/catalog/tracks/[0-9a-fA-F-]{36}$", RegexOptions.CultureInvariant)]
    private static partial Regex TrackPage();
}
