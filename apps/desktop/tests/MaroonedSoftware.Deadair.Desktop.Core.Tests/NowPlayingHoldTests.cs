using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using MaroonedSoftware.Deadair.Sdk.Models;
using Microsoft.Extensions.Time.Testing;
using Xunit;
using NowPlayingReading = MaroonedSoftware.Deadair.Sdk.Models.NowPlaying;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Whether a now-playing reading is let through the instant it arrives, or made to wait for the
/// audio to actually catch up to it.
/// </summary>
public class NowPlayingHoldTests
{
    [Fact]
    public void HoldsTheVeryFirstReadingItIsEverOffered_TheSameAsAnyNewItem()
    {
        // Nothing has played yet, which is exactly the situation a genuinely new item is in: this
        // hold does not special-case a fresh start to skip the five seconds a first item deserves
        // just as much as a later one.
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        var released = new List<NowPlayingReading>();
        hold.Released += released.Add;

        var reading = Reading("100");
        var immediate = hold.Offer("100", reading);

        Assert.Null(immediate);
        Assert.Null(hold.Current);
        Assert.Empty(released);

        time.Advance(NowPlayingHold.NowPlayingLead - TimeSpan.FromMilliseconds(1));
        Assert.Empty(released);
        Assert.Null(hold.Current);

        time.Advance(TimeSpan.FromMilliseconds(1));
        Assert.Same(reading, Assert.Single(released));
        Assert.Same(reading, hold.Current);
    }

    [Fact]
    public void HoldsALaterNewItem_UntilItsOwnLeadHasElapsed()
    {
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        hold.Offer("100", Reading("100"));
        time.Advance(NowPlayingHold.NowPlayingLead);

        var released = new List<NowPlayingReading>();
        hold.Released += released.Add;

        var second = Reading("200");
        var immediate = hold.Offer("200", second);

        Assert.Null(immediate);
        Assert.Empty(released);

        time.Advance(NowPlayingHold.NowPlayingLead - TimeSpan.FromMilliseconds(1));
        Assert.Empty(released);

        time.Advance(TimeSpan.FromMilliseconds(1));
        Assert.Same(second, Assert.Single(released));
        Assert.Same(second, hold.Current);
    }

    [Fact]
    public void PassesASameItemUpdate_Immediately()
    {
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        hold.Offer("100", Reading("100"));
        time.Advance(NowPlayingHold.NowPlayingLead);

        var released = new List<NowPlayingReading>();
        hold.Released += released.Add;

        var update = Reading("100", listeners: 42);
        var result = hold.Offer("100", update);

        // Straight through: a field update on the item already current carries none of the lag a
        // new one does, so it is returned rather than made to wait, and the timer-driven event never
        // fires for it.
        Assert.Same(update, result);
        Assert.Same(update, hold.Current);
        Assert.Empty(released);
    }

    [Fact]
    public void ASecondNewItemDuringTheHold_ReplacesTheFirstAndResetsTheLead()
    {
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        var released = new List<NowPlayingReading>();
        hold.Released += released.Add;

        hold.Offer("100", Reading("100"));
        time.Advance(NowPlayingHold.NowPlayingLead);
        Assert.Single(released);
        released.Clear();

        hold.Offer("200", Reading("200"));
        time.Advance(TimeSpan.FromSeconds(2));

        var third = Reading("300");
        hold.Offer("300", third);

        // The second item's lead was two seconds in when the third replaced it; the third gets its
        // own full five seconds rather than the three that were left on the second's.
        time.Advance(TimeSpan.FromSeconds(3));
        Assert.Empty(released);

        time.Advance(TimeSpan.FromSeconds(2));
        Assert.Same(third, Assert.Single(released));
        Assert.Same(third, hold.Current);
    }

    private static NowPlayingReading Reading(string startedAt, long listeners = 0) => new()
    {
        Station = "deadair",
        OnAir = true,
        Listeners = listeners,
        Mounts = [],
        Track = new NowPlayingTrack
        {
            Title = "Track " + startedAt,
            Artist = "Artist",
            StartedAt = long.Parse(startedAt, CultureInfo.InvariantCulture),
        },
    };
}
