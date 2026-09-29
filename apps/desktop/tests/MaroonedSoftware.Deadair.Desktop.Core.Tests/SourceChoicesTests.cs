using MaroonedSoftware.Deadair.Desktop.Core.Programme;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What the "Playing from" and "Hosted by" pickers offer.
/// </summary>
/// <remarks>
/// A playlist the source will not hand over only moves the failure to air time, and a caller picked as
/// a host presents a show in a character whose whole premise is phoning in. But what a slot ALREADY
/// holds must always be offered, or the picker draws it as nothing and the operator reads a slot that
/// plays nothing.
/// </remarks>
public class SourceChoicesTests
{
    [Fact]
    public void NothingComesFirst_ThenTheStationsOwn_ThenProviders_ThenCharts()
    {
        var choices = SourceChoices.Build(
            [Owned("7d8f2a3e-0000-4000-8000-000000000001", "Late night")],
            [Playlist("dw", "Discover Weekly")],
            [new StationChart { Id = "lastfm:top", PluginId = "lastfm", Name = "Top 40" }],
            null);

        Assert.Equal([SourceChoices.Nothing, "Late night", "Discover Weekly", "Top 40"], choices.Select(choice => choice.Label));
        Assert.Null(choices[0].Source);
    }

    [Fact]
    public void AHiddenOrRefusedPlaylistIsNotOffered()
    {
        var choices = SourceChoices.Build(
            [],
            [
                Playlist("a", "Hidden") with { Hidden = true },
                Playlist("b", "Refused") with { Permissions = [PlaylistPermission.Edit] },
                Playlist("c", "Unsaid"),
                Playlist("d", "Readable") with { Permissions = [PlaylistPermission.Read] },
            ],
            [],
            null);

        Assert.Equal([SourceChoices.Nothing, "Unsaid", "Readable"], choices.Select(choice => choice.Label));
    }

    [Fact]
    public void WhatTheSlotHoldsIsOfferedEvenHidden()
    {
        var chosen = new ProgrammeSource.Playlist("spotify", "a");

        var choices = SourceChoices.Build([], [Playlist("a", "Hidden") with { Hidden = true }], [], chosen);

        Assert.Contains(choices, choice => choice.Source == chosen && choice.Label == "Hidden");
    }

    [Fact]
    public void WhatTheSlotHoldsIsOfferedUnderItsIdWhenNothingNamesIt()
    {
        var chosen = new ProgrammeSource.Chart("lastfm:gone");

        var choices = SourceChoices.Build([], [], [], chosen);

        Assert.Equal("lastfm:gone", choices.Single(choice => choice.Source == chosen).Label);
    }

    [Fact]
    public void AStoredSlotsSourceIsReadInTheStationsPrecedence()
    {
        var slot = new ScheduleSlot
        {
            Id = "s",
            Label = "x",
            StartsAtMinutes = 0,
            EndsAtMinutes = 60,
            SourcePluginId = "spotify",
            SourcePlaylistId = "dw",
            SourceChartId = "lastfm:top",
            Mode = ScheduleSlotMode.Rotation,
            OnEnd = ScheduleSlotOnEnd.Extend,
        };

        Assert.Equal(new ProgrammeSource.Chart("lastfm:top"), ProgrammeSource.Of(slot));
        Assert.Equal(new ProgrammeSource.Playlist("spotify", "dw"), ProgrammeSource.Of(slot with { SourceChartId = null }));
    }

    [Fact]
    public void ACallerIsNeverOfferedAsAHost_UnlessTheSlotAlreadyNamesOne()
    {
        List<Persona> personas = [Persona("h", PersonaKind.Host), Persona("c", PersonaKind.Caller), Persona("n", null)];

        Assert.Equal([null, "h", "n"], TimetableViewModel.Hosts(personas, null).Select(host => host.Id));
        Assert.Equal([null, "h", "c", "n"], TimetableViewModel.Hosts(personas, "c").Select(host => host.Id));
    }

    private static StationPlaylist Owned(string id, string name) => new()
    {
        Id = id,
        Name = name,
        Prompt = string.Empty,
        TrackCount = 0,
        ResolvedCount = 0,
        CreatedAt = DateTimeOffset.UnixEpoch,
        UpdatedAt = DateTimeOffset.UnixEpoch,
    };

    private static CatalogPlaylist Playlist(string id, string name) => new() { PluginId = "spotify", PluginName = "Spotify", Id = id, Name = name };

    private static Persona Persona(string id, PersonaKind? kind) => new()
    {
        Id = id,
        Key = id,
        Label = id,
        Kind = kind,
        Style = string.Empty,
        DefaultHost = false,
        Presenting = false,
    };
}
