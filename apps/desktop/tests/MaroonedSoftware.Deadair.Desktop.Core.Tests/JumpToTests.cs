using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What the jump-to palette offers, and that every place it offers is really there.
/// </summary>
/// <remarks>
/// The palette names tabs by the member names of each page's own enum. A tab renamed or removed on a
/// page would otherwise leave a row that opens the page on whatever tab it was already on, which is
/// the palette quietly lying about where it goes.
/// </remarks>
public class JumpToTests
{
    public static TheoryData<JumpPlace, string> Tabs()
    {
        var data = new TheoryData<JumpPlace, string>();
        foreach (var page in JumpTo.Pages.Where(page => page.Tab.Length > 0))
        {
            data.Add(page.Place, page.Tab);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Tabs))]
    public void EveryTabThePaletteNamesIsATabOnThatPage(JumpPlace place, string tab)
    {
        var known = place switch
        {
            JumpPlace.Programme => Enum.TryParse<ProgrammeTab>(tab, out _),
            JumpPlace.Library => Enum.TryParse<LibraryTab>(tab, out _),
            JumpPlace.Voice => Enum.TryParse<VoiceTab>(tab, out _),
            JumpPlace.Checkup => Enum.TryParse<CheckupTab>(tab, out _),
            JumpPlace.Settings => Enum.TryParse<SettingsSectionId>(tab, out _),
            _ => false,
        };

        Assert.True(known, $"{place} has no tab called {tab}.");
    }

    [Fact]
    public void EveryTabOnEveryPageIsInThePalette()
    {
        // The other direction: a tab added to a page and forgotten here is a tab the palette cannot reach.
        static IEnumerable<string> Named(JumpPlace place) =>
            JumpTo.Pages.Where(page => page.Place == place).Select(page => page.Tab);

        Assert.Equal(Enum.GetNames<ProgrammeTab>().Order(), Named(JumpPlace.Programme).Order());
        Assert.Equal(Enum.GetNames<LibraryTab>().Order(), Named(JumpPlace.Library).Order());
        Assert.Equal(Enum.GetNames<VoiceTab>().Order(), Named(JumpPlace.Voice).Order());
        Assert.Equal(Enum.GetNames<CheckupTab>().Order(), Named(JumpPlace.Checkup).Order());
        Assert.Equal(SettingsSections.All.Select(section => section.Id.ToString()).Order(), Named(JumpPlace.Settings).Order());
    }

    [Fact]
    public void TypingAPagesNameOffersEveryTabOnIt()
    {
        // Every tab on Voice, and Settings' "Voice and audio" too: a name that matches is a match.
        var found = JumpTo.Filter(JumpTo.Pages, "voice");

        Assert.All(JumpTo.Pages.Where(page => page.Place == JumpPlace.Voice), page => Assert.Contains(page, found));
        Assert.Contains(found, page => page.Label == "Voice and audio");
    }

    [Fact]
    public void NothingTypedOffersEverything() =>
        Assert.Equal(JumpTo.Pages.Count, JumpTo.Filter(JumpTo.Pages, "  ").Count);

    [Theory]
    [InlineData("a", false)]
    [InlineData(" a ", false)]
    [InlineData("al", true)]
    public void ASingleLetterAsksTheStationNothing(string query, bool searches) =>
        Assert.Equal(searches, JumpTo.Searches(query));
}
