using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Desktop.Themes;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The Settings page's list of sections, and what each one keeps while somebody looks at another.
/// </summary>
/// <remarks>
/// The list is the only list, as it is on the web: a group nothing names is drawn nowhere here, so a
/// group named twice would be two forms saving the same settings, and a station section shown to a
/// listener would be a page whose every call is refused. And every section saves on its own, which is
/// only true if a save in one section leaves an unsaved edit in another alone.
/// </remarks>
public sealed class SettingsSectionsTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"deadair-sections-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(_directory))
        {
            Directory.Delete(_directory, recursive: true);
        }
    }

    [Fact]
    public void ThisAppsOwnCardComesFirstAndIsTheOnlySectionWithNoAccount()
    {
        Assert.Equal(SettingsSectionId.App, SettingsSections.All[0].Id);
        Assert.Single(SettingsSections.All, section => !section.NeedsOperator);
    }

    [Fact]
    public void NoGroupIsDrawnByTwoSections()
    {
        var groups = SettingsSections.All.Where(section => section.Group is not null).Select(section => section.Group).ToList();
        Assert.Equal(groups.Count, groups.Distinct().Count());
    }

    [Theory]
    [InlineData(SettingGroup.Schedule)]
    [InlineData(SettingGroup.Personas)]
    [InlineData(SettingGroup.Phrasings)]
    [InlineData(SettingGroup.Providers)]
    public void AGroupAnotherPageDrawsIsNotASectionHere_WhichWouldDrawItTwice(SettingGroup group) =>
        Assert.DoesNotContain(SettingsSections.All, section => section.Group == group);

    [Fact]
    public void EverySectionThatDrawsAGroupSaysWhatItHolds() =>
        Assert.All(SettingsSections.All.Where(section => section.Group is not null), section => Assert.False(string.IsNullOrWhiteSpace(section.Blurb)));

    [Fact]
    public void AGroupsFieldsAreItsOwnInTheOrderDeclared()
    {
        var settings = Settings(("b", SettingGroup.Mail), ("a", SettingGroup.Playout), ("c", SettingGroup.Mail));

        Assert.Equal(["b", "c"], SettingsSections.Fields(settings, SettingGroup.Mail).Select(field => field.Key));
    }

    [Fact]
    public void AListenerIsShownOnlyThisAppsCard()
    {
        var page = Page();

        page.ApplyRole(false);

        Assert.Empty(page.StationSections);
        Assert.Equal([page.AppSection], page.Sections);
    }

    [Fact]
    public void AnOperatorIsShownEveryStationSection()
    {
        var page = Page();

        page.ApplyRole(true);

        Assert.Equal(SettingsSections.All.Count - 1, page.StationSections.Count);
        Assert.Equal(SettingsSections.All.Count, page.Sections.Count);
    }

    [Fact]
    public void SomebodyWhoStopsBeingTheOperatorOnAStationSectionIsSentBackToThisAppsCard()
    {
        var page = Page();
        page.ApplyRole(true);
        page.ShowSectionCommand.Execute(page.StationSections.First(section => section.Id == SettingsSectionId.Mail));

        page.ApplyRole(false);

        Assert.Same(page.AppSection, page.Current);
        Assert.True(page.AppSection.IsActive);
    }

    [Fact]
    public void ASaveElsewhereLeavesAnUnsavedEditAlone_ButTheSectionThatSavedTakesTheFreshValues()
    {
        var group = new SettingsGroupViewModel(
            SettingsSections.All.First(section => section.Id == SettingsSectionId.Mail),
            Calls(),
            (_, _) => { });
        group.Present(Settings(("mail.host", SettingGroup.Mail)), force: true);
        var field = Assert.IsType<TextFormFieldViewModel>(group.Form!.Fields[0]);
        field.Text = "typed and not saved";

        group.Present(Settings(("mail.host", SettingGroup.Mail)), force: false);
        Assert.Equal("typed and not saved", Assert.IsType<TextFormFieldViewModel>(group.Form!.Fields[0]).Text);
        Assert.True(group.IsDirty);

        group.Present(Settings(("mail.host", SettingGroup.Mail)), force: true);
        Assert.Equal("stored", Assert.IsType<TextFormFieldViewModel>(group.Form!.Fields[0]).Text);
        Assert.False(group.IsDirty);
    }

    [Fact]
    public void AGroupWithNothingDeclaredSaysSoRatherThanDrawingAnEmptyForm()
    {
        var group = new SettingsGroupViewModel(
            SettingsSections.All.First(section => section.Id == SettingsSectionId.Station),
            Calls(),
            (_, _) => { });

        group.Present(Settings(("mail.host", SettingGroup.Mail)), force: true);

        Assert.True(group.IsEmpty);
        Assert.False(group.HasForm);
    }

    [Fact]
    public void AnEditInASectionIsMarkedInTheList()
    {
        var page = Page();
        page.ApplyRole(true);
        page.Present(Settings(("mail.host", SettingGroup.Mail)));
        var entry = page.StationSections.First(section => section.Id == SettingsSectionId.Mail);
        var group = Assert.IsType<SettingsGroupViewModel>(entry.Content);

        Assert.IsType<TextFormFieldViewModel>(group.Form!.Fields[0]).Text = "smtp.example.org";

        Assert.True(entry.IsDirty);
    }

    private static StationSettings Settings(params (string Key, SettingGroup Group)[] fields) => new()
    {
        Descriptors = [.. fields.Select(field => new StationSettingDescriptor { Key = field.Key, Label = field.Key, Type = ConfigFieldType.String, Group = field.Group })],
        Values = fields.ToDictionary(field => field.Key, _ => JsonSerializer.SerializeToElement("stored")),
        Configured = [],
        Derived = [],
    };

    private static (OperatorActions Actions, HttpClient Http, SessionManager Session, DialogsViewModel Dialogs) Parts()
    {
        var http = new HttpClient(new FakeTransport());
        var session = new SessionManager(new InMemorySecretStore(), http);
        var actions = new OperatorActions(session);
        return (actions, http, session, new DialogsViewModel(actions, ImmediateUiDispatcher.Instance));
    }

    private static SettingsCalls Calls()
    {
        var (actions, http, _, dialogs) = Parts();
        return new SettingsCalls(actions, http, dialogs, files: null) { Station = Station() };
    }

    private SettingsViewModel Page()
    {
        var (actions, http, session, dialogs) = Parts();
        var page = new SettingsViewModel(actions, http, new FileSettingsStore(_directory), new ThemeManager(), dialogs, session, ImmediateUiDispatcher.Instance);
        page.Attach(Station());
        return page;
    }

    private static StationUrl Station() =>
        StationUrl.TryParse("https://radio.example.com", out var station) ? station : throw new InvalidOperationException();
}
