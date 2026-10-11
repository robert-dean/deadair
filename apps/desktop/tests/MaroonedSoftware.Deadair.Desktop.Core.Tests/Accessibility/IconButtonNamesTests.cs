using System.Xml;
using System.Xml.Linq;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests.Accessibility;

/// <summary>
/// Every control VoiceOver cannot name from what it draws carries a name of its own.
/// </summary>
/// <remarks>
/// A button whose content is a glyph and nothing else is announced as "button" and no more, and a
/// tooltip does not help: VoiceOver reads <c>AutomationProperties.Name</c> and a string content, and
/// a tooltip is neither. A slider and a progress bar draw no words at all. There are no UI tests in
/// this tree, so the views are read as XML instead, which is enough: whether a name is there is a
/// fact about the markup, not about anything running.
/// </remarks>
public class IconButtonNamesTests
{
    private static readonly HashSet<string> Pressable = ["Button", "ToggleButton", "RepeatButton"];

    private static readonly HashSet<string> Wordless = ["Slider", "ProgressBar"];

    private static readonly string[] Folders = ["Views", "Controls"];

    private static readonly HashSet<string> Icons = ["PathIcon", "Image"];

    private static readonly HashSet<string> Words = ["TextBlock", "SelectableTextBlock", "AccessText", "Run"];

    /// <summary>
    /// The controls that had no name when this test was written. The list only ever shrinks: a new
    /// control without a name fails, and so does one named without being taken off the list, so it
    /// cannot go stale and hide the next one.
    /// </summary>
    private static readonly string[] KnownUnnamed =
    [
        "Views/ActsTab.axaml: Button 'Turn the order around'",
        "Views/AlbumsTab.axaml: Button 'Turn the order around'",
        "Views/FormFieldView.axaml: Slider '{Binding Value}'",
        "Views/LoginView.axaml: ToggleButton 'Show the password'",
        "Views/MachineryTab.axaml: ProgressBar '{Binding MeasuredPercent}'",
        "Views/PlayerBar.axaml: Button 'Shuffle what is coming up'",
        "Views/PlayerBar.axaml: Button '{Binding PlayLabel, StringFormat='{}{0} (Space)'}'",
        "Views/PlayerBar.axaml: Button 'Skip this record'",
        "Views/PlayerBar.axaml: ProgressBar '{Binding Position}'",
        "Views/PlayerBar.axaml: Slider '{Binding Volume, Mode=TwoWay}'",
        "Views/PlayerBar.axaml: Button '{Binding OutputName}'",
        "Views/PlayerBar.axaml: Button 'Now playing'",
        "Views/PlayerBar.axaml: Button 'Studio (F)'",
        "Views/PlayerBar.axaml: Button 'Open the desk'",
        "Views/PlaylistsTab.axaml: Button '{Binding Name, StringFormat='More about {0}'}'",
        "Views/RatingStrip.axaml: Button '{Binding DislikeHint}'",
        "Views/RatingStrip.axaml: Button '{Binding NeutralHint}'",
        "Views/RatingStrip.axaml: Button '{Binding LikeHint}'",
        "Views/RecordsTab.axaml: Button 'Turn the order around'",
        "Views/RunningOrderView.axaml: Button 'Skip straight to this record. Everything in front of it is passed over and what is on air is cut.'",
        "Views/RunningOrderView.axaml: Button '{Binding $parent[ListBox].((vm:RunningOrderViewModel)DataContext).MoveUpCommand}'",
        "Views/RunningOrderView.axaml: Button '{Binding $parent[ListBox].((vm:RunningOrderViewModel)DataContext).MoveDownCommand}'",
        "Views/RunningOrderView.axaml: Button '{Binding $parent[ListBox].((vm:RunningOrderViewModel)DataContext).DropCommand}'",
        "Views/Settings/SettingsProvidersSection.axaml: Button 'Ask it sooner'",
        "Views/Settings/SettingsProvidersSection.axaml: Button 'Ask it later'",
        "Views/Settings/SettingsStorageSection.axaml: ProgressBar '{Binding Share}'",
        "Views/SetupView.axaml: Button 'Back'",
        "Views/SetupView.axaml: Button '{Binding DeclineLabel}'",
        "Views/ShellView.axaml: Button 'Dismiss'",
        "Views/Sidebar.axaml: Button 'Sign out'",
        "Views/StationAirView.axaml: Button 'Dislike it: the station stops choosing it.'",
        "Views/StationAirView.axaml: Button 'No opinion: it plays as often as anything else.'",
        "Views/StationAirView.axaml: Button 'Like it: the station chooses it more often.'",
        "Views/StudioView.axaml: Button 'Leave Studio (Esc)'",
        "Views/StudioView.axaml: ProgressBar '{Binding Listener.Position}'",
        "Views/StudioView.axaml: Button '{Binding Listener.PlayLabel, StringFormat='{}{0} (Space)'}'",
        "Views/TodayTab.axaml: ProgressBar '{Binding ProgressValue}'",
        "Views/TodayTab.axaml: Button 'Move up'",
        "Views/TodayTab.axaml: Button 'Move down'",
    ];

    [Fact]
    public void NoNewControlGoesUnnamed()
    {
        var found = Unnamed().ToList();
        var known = new HashSet<string>(KnownUnnamed, StringComparer.Ordinal);

        var added = found.Where(control => !known.Contains(control.Key)).Select(control => control.Where).ToList();

        Assert.True(added.Count == 0,
            "These controls draw no words and have no AutomationProperties.Name, so VoiceOver calls them \"button\" "
            + "and nothing more. Bind the name to the same text as the tooltip:\n" + string.Join("\n", added));
    }

    [Fact]
    public void TheKnownListOnlyShrinks()
    {
        var found = Unnamed().Select(control => control.Key).ToHashSet(StringComparer.Ordinal);

        var named = KnownUnnamed.Where(key => !found.Contains(key)).ToList();

        Assert.True(named.Count == 0,
            "These have a name now (or are gone), so take them off KnownUnnamed:\n" + string.Join("\n", named));
    }

    [Fact]
    public void TheViewsAreFound()
    {
        // A walk that found no files would pass both tests above while checking nothing.
        Assert.True(Markup().Count() > 50);
    }

    /// <summary>Every control in the app's markup that draws no words and has no name.</summary>
    private static IEnumerable<(string Key, string Where)> Unnamed()
    {
        foreach (var (relative, document) in Markup())
        {
            foreach (var element in document.Descendants())
            {
                var kind = element.Name.LocalName;
                var wordless = Wordless.Contains(kind) || (Pressable.Contains(kind) && OnlyAnIcon(element));

                if (!wordless || Attribute(element, "AutomationProperties.Name") is not null)
                {
                    continue;
                }

                var label = Attribute(element, "ToolTip.Tip") ?? Attribute(element, "Command") ?? Attribute(element, "Value")
                    ?? Attribute(element, "Name") ?? "";
                var key = $"{relative}: {kind} '{label}'";
                var line = ((IXmlLineInfo)element).LineNumber;

                yield return (key, $"{relative}:{line} {kind} '{label}'");
            }
        }
    }

    /// <summary>
    /// A pressable control whose content holds an icon and no words. A string content (an attribute or
    /// text between the tags) is a name already, and so is a text block inside a panel.
    /// </summary>
    private static bool OnlyAnIcon(XElement element)
    {
        if (Attribute(element, "Content") is not null || !string.IsNullOrWhiteSpace(string.Concat(element.Nodes().OfType<XText>())))
        {
            return false;
        }

        // `Button.Flyout` and its like are properties, not content.
        var content = element.Elements().Where(child => !child.Name.LocalName.Contains('.', StringComparison.Ordinal)).ToList();
        var drawn = content.SelectMany(child => child.DescendantsAndSelf()).Select(child => child.Name.LocalName).ToList();

        return drawn.Any(Icons.Contains) && !drawn.Any(Words.Contains);
    }

    private static string? Attribute(XElement element, string name) =>
        element.Attributes().FirstOrDefault(attribute => attribute.Name.LocalName == name)?.Value;

    /// <summary>Every view and control the app draws, parsed, with its path under the app project.</summary>
    private static IEnumerable<(string Relative, XDocument Document)> Markup()
    {
        var app = AppProject();

        return Folders
            .Select(folder => Path.Combine(app, folder))
            .Where(Directory.Exists)
            .SelectMany(folder => Directory.EnumerateFiles(folder, "*.axaml", SearchOption.AllDirectories))
            .Order(StringComparer.Ordinal)
            .Select(file => (Path.GetRelativePath(app, file).Replace('\\', '/'), XDocument.Load(file, LoadOptions.SetLineInfo)));
    }

    /// <summary>Walks up from the test binary to the app project's source.</summary>
    private static string AppProject()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            var candidate = Path.Combine(directory.FullName, "src", "MaroonedSoftware.Deadair.Desktop");

            if (Directory.Exists(Path.Combine(candidate, "Views")))
            {
                return candidate;
            }

            directory = directory.Parent;
        }

        Assert.Fail("Found no src/MaroonedSoftware.Deadair.Desktop/Views above " + AppContext.BaseDirectory);
        return "";
    }
}
