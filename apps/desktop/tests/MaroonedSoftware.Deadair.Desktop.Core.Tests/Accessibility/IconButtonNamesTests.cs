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

    [Fact]
    public void EveryWordlessControlHasAName()
    {
        var unnamed = Unnamed().ToList();

        Assert.True(unnamed.Count == 0,
            "These controls draw no words and have no AutomationProperties.Name, so VoiceOver calls them \"button\" "
            + "and nothing more. Bind the name to the same text as the tooltip, less any shortcut:\n" + string.Join("\n", unnamed));
    }

    [Fact]
    public void TheViewsAreFound()
    {
        // A walk that found no files would pass the test above while checking nothing.
        Assert.True(Markup().Count() > 50);
    }

    /// <summary>Every control in the app's markup that draws no words and has no name.</summary>
    private static IEnumerable<string> Unnamed()
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
                var line = ((IXmlLineInfo)element).LineNumber;

                yield return $"{relative}:{line} {kind} '{label}'";
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
