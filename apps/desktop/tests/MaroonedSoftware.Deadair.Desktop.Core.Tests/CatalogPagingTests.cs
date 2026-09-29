using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Where a paged list says it is, and how long a record is.
/// </summary>
/// <remarks>
/// The last page of a list is short, and a summary that said "751–800 of 766" would promise rows that
/// do not exist. A record nobody has measured is not zero seconds long.
/// </remarks>
public class CatalogPagingTests
{
    [Theory]
    [InlineData(0, 50, 766, true)]
    [InlineData(15, 50, 766, false)]
    [InlineData(0, 50, 50, false)]
    public void ThereIsANextPageOnlyWhenRowsRemain(long page, long size, long total, bool expected) =>
        Assert.Equal(expected, CatalogPaging.HasNext(page, size, total));

    [Fact]
    public void TheLastPageSaysWhereTheListEnds() =>
        Assert.EndsWith("–766 of 766", CatalogPaging.Summary(15, 50, 766), StringComparison.Ordinal);

    [Fact]
    public void AnEmptyListSaysNothingHere() => Assert.Equal(string.Empty, CatalogPaging.Summary(0, 50, 0));

    [Theory]
    [InlineData(341_000L, "5:41")]
    [InlineData(0L, "--:--")]
    [InlineData(null, "--:--")]
    [InlineData(3_723_000L, "1:02:03")]
    public void ALengthIsMinutesAndSecondsOrUnknown(long? ms, string expected) =>
        Assert.Equal(expected, CatalogPaging.Length(ms));
}
