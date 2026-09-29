using MaroonedSoftware.Deadair.Desktop.Core.Checkup;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What a Check now found, and the notes of a release drawn without a Markdown renderer.
/// </summary>
/// <remarks>
/// The tab redraws from the same answer whatever it holds, so "GitHub did not answer" is the one
/// outcome nothing else on screen would say: without it a failed check looks exactly like nothing
/// newer being out, and only one of the two is true.
/// </remarks>
public sealed class ReleaseCheckTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 29, 12, 0, 0, TimeSpan.Zero);

    private static StationReleases Releases(DateTimeOffset? checkedAt, string? current, params string[] available) => new()
    {
        Checks = true,
        CheckedAt = checkedAt,
        Current = current,
        Notes = [],
        Available = [.. available.Select(version => new StationRelease { Version = version, Notes = string.Empty })],
    };

    [Fact]
    public void AnAnswerOlderThanTheCheckSaysGitHubDidNotAnswer()
    {
        var releases = Releases(Now.AddMinutes(-30), "1.4.0");

        Assert.Equal("GitHub did not answer. The station will try again within the hour.", ReleaseCheck.Outcome(releases, Now));
    }

    [Fact]
    public void NoAnswerAtAllSaysTheSame()
    {
        Assert.StartsWith("GitHub did not answer", ReleaseCheck.Outcome(Releases(null, "1.4.0"), Now), StringComparison.Ordinal);
    }

    [Fact]
    public void AFreshAnswerWithNothingNewerNamesTheReleaseThisIs()
    {
        Assert.Equal("Nothing newer than 1.4.0 is out.", ReleaseCheck.Outcome(Releases(Now.AddSeconds(-5), "1.4.0"), Now));
        Assert.Equal("Nothing newer is out.", ReleaseCheck.Outcome(Releases(Now.AddSeconds(-5), null), Now));
    }

    [Fact]
    public void OneNewerReleaseIsNamed_AndSeveralAreCountedNewestFirst()
    {
        Assert.Equal("deadair 1.5.0 is out.", ReleaseCheck.Outcome(Releases(Now.AddSeconds(-5), "1.4.0", "1.5.0"), Now));
        Assert.Equal(
            "2 newer releases are out, the newest 1.6.0.",
            ReleaseCheck.Outcome(Releases(Now.AddSeconds(-5), "1.4.0", "1.6.0", "1.5.0"), Now));
    }

    [Fact]
    public void NotesLoseTheirMarksAndKeepTheirWords()
    {
        const string Markdown = """
            ### Minor Changes

            - 1a2b3c4: **The desk** can skip from the [menu bar](https://example.com/menu).
              - Uses `SkipCommand`, the same one the bar does.


            ### Patch Changes
            * Fixed a crash.
            """;

        Assert.Equal(
            "Minor Changes\n\n• 1a2b3c4: The desk can skip from the menu bar.\n  • Uses SkipCommand, the same one the bar does.\n\nPatch Changes\n• Fixed a crash.",
            ReleaseCheck.PlainNotes(Markdown));
    }

    [Fact]
    public void EmptyNotesStayEmpty()
    {
        Assert.Equal(string.Empty, ReleaseCheck.PlainNotes("\n\n"));
    }
}
