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

    /// <summary>
    /// The station is polled every three seconds and the lead is five, so the record being held is
    /// read again before its lead is spent. Each of those readings restarted the lead, and a record
    /// polled faster than it could be released was never released at all: the listener showed the
    /// station on air with no record for as long as it kept answering.
    /// </summary>
    [Fact]
    public void TheHeldItemReadAgain_KeepsItsLeadAndReleasesTheLatestReading()
    {
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        var released = new List<NowPlayingReading>();
        hold.Released += released.Add;

        hold.Offer("100", Reading("100"));
        time.Advance(TimeSpan.FromSeconds(3));

        var again = Reading("100", listeners: 2);
        Assert.Null(hold.Offer("100", again));

        time.Advance(TimeSpan.FromSeconds(2));
        Assert.Same(again, Assert.Single(released));
        Assert.Same(again, hold.Current);
    }

    /// <summary>
    /// A record the old station announced just before a switch must never be released onto the new
    /// station's screen, and the new station's first record is new rather than "the same item".
    /// </summary>
    [Fact]
    public void AResetDropsWhatWasHeld_AndForgetsWhatWasCurrent()
    {
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        hold.Offer("100", Reading("100"));
        time.Advance(NowPlayingHold.NowPlayingLead);
        hold.Offer("200", Reading("200"));

        var released = new List<NowPlayingReading>();
        hold.Released += released.Add;

        hold.Reset();
        time.Advance(NowPlayingHold.NowPlayingLead);

        Assert.Empty(released);
        Assert.Null(hold.Current);

        // The same key as before the reset is new to it now, so it waits like any new item.
        Assert.Null(hold.Offer("100", Reading("100")));
    }

    [Fact]
    public void ReleasesAHeldItem_WithWhenTheListenerHearsIt()
    {
        // The lead is how far behind the station the audio is, so the moment a reading describes
        // reaches the speakers a lead after it was read. The playhead projects from that, and so runs
        // under the title it is drawn with instead of a lead ahead of it.
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        var readAt = new DateTimeOffset(2026, 10, 10, 12, 0, 0, TimeSpan.Zero);
        var reading = Reading("100");

        hold.Offer("100", reading, readAt);
        Assert.Null(hold.Heard);

        time.Advance(NowPlayingHold.NowPlayingLead);
        Assert.Equal(new HeardReading(reading, readAt + NowPlayingHold.NowPlayingLead), hold.Heard);
    }

    [Fact]
    public void ReleasesTheNewestReadingOfAHeldItem_WithItsOwnReadAt()
    {
        // Polled again inside the lead: the newer reading is the one released, and its stamp goes
        // with it. A stamp from the first poll with the second poll's countdown would put the bar a
        // poll interval out.
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        var readAt = new DateTimeOffset(2026, 10, 10, 12, 0, 0, TimeSpan.Zero);
        hold.Offer("100", Reading("100"), readAt);
        time.Advance(TimeSpan.FromSeconds(3));
        var newer = Reading("100", listeners: 7);
        hold.Offer("100", newer, readAt.AddSeconds(3));

        time.Advance(NowPlayingHold.NowPlayingLead);

        Assert.Equal(new HeardReading(newer, readAt.AddSeconds(3) + NowPlayingHold.NowPlayingLead), hold.Heard);
    }

    [Fact]
    public void KeepsTheCurrentRecordsAnchor_WhileTheNextIsHeld()
    {
        // While a new record waits out its lead, the one still playing is what the bar is under. The
        // view used to project from the repository's latest reading, which by then was the NEXT
        // record's countdown under the current record's title.
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        var readAt = new DateTimeOffset(2026, 10, 10, 12, 0, 0, TimeSpan.Zero);
        var current = Reading("100");
        hold.Offer("100", current, readAt);
        time.Advance(NowPlayingHold.NowPlayingLead);

        hold.Offer("200", Reading("200"), readAt.AddSeconds(9));

        Assert.Equal(new HeardReading(current, readAt + NowPlayingHold.NowPlayingLead), hold.Heard);
    }

    [Fact]
    public void PassesASameItemUpdate_WithItsOwnHeardAt()
    {
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        var readAt = new DateTimeOffset(2026, 10, 10, 12, 0, 0, TimeSpan.Zero);
        hold.Offer("100", Reading("100"), readAt);
        time.Advance(NowPlayingHold.NowPlayingLead);

        var update = Reading("100", listeners: 42);
        hold.Offer("100", update, readAt.AddSeconds(6));

        // The audio is the same lead behind the station for a reading of the same record, so its
        // anchor moves on by the same amount; the bar re-anchors on every reading as it always did.
        Assert.Equal(new HeardReading(update, readAt.AddSeconds(6) + NowPlayingHold.NowPlayingLead), hold.Heard);
    }

    [Fact]
    public void ForgetsWhenTheListenerHeardIt_OnReset()
    {
        var time = new FakeTimeProvider();
        var hold = new NowPlayingHold(time);
        hold.Offer("100", Reading("100"), DateTimeOffset.UnixEpoch);
        time.Advance(NowPlayingHold.NowPlayingLead);

        hold.Reset();

        Assert.Null(hold.Heard);
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
