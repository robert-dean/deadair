using MaroonedSoftware.Deadair.Desktop.Core.Updates;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public class UpdateCheckTests
{
    // The shape `git/matching-refs/tags/desktop-v` answers, in GitHub's order (by name, so 0.10 sorts
    // before 0.2), with a prerelease tag among them.
    private const string Refs = """
        [
          { "ref": "refs/tags/desktop-v0.1.0", "object": { "type": "commit" } },
          { "ref": "refs/tags/desktop-v0.10.0", "object": { "type": "commit" } },
          { "ref": "refs/tags/desktop-v0.2.0", "object": { "type": "commit" } },
          { "ref": "refs/tags/desktop-v0.11.0-rc.1", "object": { "type": "commit" } }
        ]
        """;

    [Fact]
    public void TheHighestVersionWins_WhateverOrderGitHubListsThemIn()
    {
        var found = UpdateCheck.Newest(new Version(0, 1, 0), Refs);

        Assert.NotNull(found);
        Assert.Equal(new Version(0, 10, 0), found.Version);
    }

    [Fact]
    public void SkipsAPrerelease()
    {
        var found = UpdateCheck.Newest(new Version(0, 10, 0), Refs);

        Assert.Null(found);
    }

    [Fact]
    public void AnswersTheReleasePage_NotAnAsset()
    {
        var found = UpdateCheck.Newest(new Version(0, 1, 0), Refs);

        Assert.Equal(new Uri("https://github.com/robert-dean/deadair/releases/tag/desktop-v0.10.0"), found?.Page);
    }

    [Fact]
    public void AnswersNothingWhenNothingIsNewerThanThisBuild()
    {
        Assert.Null(UpdateCheck.Newest(new Version(0, 10, 0), Refs));
        Assert.Null(UpdateCheck.Newest(new Version(1, 0, 0), Refs));
    }

    /// <summary>
    /// What GitHub answers today, since no desktop release has been published yet.
    /// </summary>
    [Fact]
    public void AnswersNothingForAnEmptyList()
    {
        Assert.Null(UpdateCheck.Newest(new Version(0, 1, 0), "[]"));
    }

    /// <summary>
    /// The request names the prefix, but only a tag that really starts with it may count: the
    /// station's `v0.4.2` would otherwise look like desktop 0.4.2.
    /// </summary>
    [Fact]
    public void IgnoresTheStationsOwnTags_WhichShareTheRepository()
    {
        const string mixed = """
            [
              { "ref": "refs/tags/v0.4.2" },
              { "ref": "refs/tags/android-v0.9.0" },
              { "ref": "refs/tags/desktop-v0.2.0" }
            ]
            """;

        Assert.Equal(new Version(0, 2, 0), UpdateCheck.Newest(new Version(0, 1, 0), mixed)?.Version);
    }

    [Fact]
    public void AVersionWrittenWithoutItsPatchIsTheSameRelease()
    {
        const string shortTag = """[ { "ref": "refs/tags/desktop-v0.2" } ]""";

        Assert.Null(UpdateCheck.Newest(new Version(0, 2, 0), shortTag));
    }

    [Fact]
    public void AnswersNothingForAnObjectRatherThanAList()
    {
        // What GitHub answers for a rate limit or a missing repository.
        Assert.Null(UpdateCheck.Newest(new Version(0, 1, 0), """{ "message": "Not Found" }"""));
    }

    [Fact]
    public void SaysWhichVersion()
    {
        Assert.Equal(
            "deadair 0.2.0 is available",
            UpdateCheck.Describe(new UpdateAvailable(new Version(0, 2, 0), new Uri("https://github.com/"))));
    }
}
