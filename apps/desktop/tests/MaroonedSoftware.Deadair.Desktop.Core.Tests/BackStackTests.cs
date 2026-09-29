using MaroonedSoftware.Deadair.Desktop.Navigation;
using MaroonedSoftware.Deadair.Desktop.ViewModels;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The rail replaces and a detail page pushes.
/// </summary>
/// <remarks>
/// Two ways of going somewhere that look alike and must not behave alike: pressing Library after a
/// chart is starting again, and Back after it would otherwise return to a page from a different
/// visit.
/// </remarks>
public class BackStackTests
{
    private static readonly Destination Chart = new Destination.ChartDetail("hot-100", "Billboard Hot 100");

    [Fact]
    public void ARailPageHasNothingToGoBackTo()
    {
        var navigation = new NavigationViewModel();

        navigation.Show(new Destination.Library());

        Assert.False(navigation.CanGoBack);
    }

    [Fact]
    public void BackFromADetailPageReturnsToThePageItWasOpenedFrom()
    {
        var navigation = new NavigationViewModel();
        navigation.Show(new Destination.Library());

        navigation.Push(Chart);
        Assert.True(navigation.CanGoBack);

        navigation.Back();

        Assert.Equal(new Destination.Library(), navigation.Current);
        Assert.False(navigation.CanGoBack);
    }

    [Fact]
    public void TheRailForgetsTheTrail()
    {
        // Back after pressing the rail would return to a chart from a visit that has already ended.
        var navigation = new NavigationViewModel();
        navigation.Show(new Destination.Library());
        navigation.Push(Chart);

        navigation.Show(new Destination.Programme());

        Assert.False(navigation.CanGoBack);
    }

    [Fact]
    public void TheRailStaysLitOnTheSectionADetailPageBelongsTo()
    {
        var navigation = new NavigationViewModel();
        navigation.ApplyRole(isOperator: true);
        navigation.Show(new Destination.Library());

        navigation.Push(Chart);

        var lit = Assert.Single(navigation.Items, item => item.IsCurrent);
        Assert.Equal(new Destination.Library(), lit.Entry.Destination);
    }

    [Fact]
    public void SigningOutOnADetailPageGoesToTheDesk()
    {
        // The chart is part of the Library, which an account buys; with none it is a page with
        // nothing behind it, the same as the Library itself.
        var navigation = new NavigationViewModel();
        navigation.ApplyRole(isOperator: true);
        navigation.Show(new Destination.Library());
        navigation.Push(Chart);

        navigation.ApplyRole(isOperator: false);

        Assert.Equal(new Destination.Desk(), navigation.Current);
        Assert.False(navigation.CanGoBack);
    }

    [Fact]
    public void BackWithNowhereToGoDoesNothing()
    {
        var navigation = new NavigationViewModel();
        var moved = 0;
        navigation.Navigated += _ => moved++;

        navigation.Back();

        Assert.Equal(0, moved);
        Assert.Equal(new Destination.Desk(), navigation.Current);
    }

    [Fact]
    public void ADetailPageIsNotOnTheRail()
    {
        Assert.DoesNotContain(Destinations.All, entry => entry.Destination is Destination.ChartDetail);
    }
}
