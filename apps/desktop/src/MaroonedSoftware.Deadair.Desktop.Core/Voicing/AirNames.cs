namespace MaroonedSoftware.Deadair.Desktop.Core.Voicing;

/// <summary>
/// A name a presenter could plausibly go by on air, offered when somebody asks for one.
/// </summary>
/// <remarks>
/// The web console's lists and shapes, ported as they are so both desks suggest from the same pool.
/// Mostly a first and a last name, sometimes a nickname, because that is what a real schedule sounds
/// like; a name identical to the one already in the box is drawn again, a few times at most.
/// </remarks>
public static class AirNames
{
    private static readonly string[] First =
    [
        "Mabel", "Ruby", "Roxy", "Stella", "Vera", "Nadine", "Marla", "Peggy", "Josie", "Delia", "Wanda", "Lorna",
        "Birdie", "Cleo", "Sadie", "Gloria", "Rita", "Bebe", "Sunny", "Kitty", "June", "Nova", "Simone", "Lola",
        "Trixie", "Etta", "Bonnie", "Maxine", "Coco", "Angie", "Jack", "Ray", "Buddy", "Duke", "Hank", "Sal",
        "Vince", "Rocco", "Gus", "Marty", "Clyde", "Otis", "Rudy", "Cash", "Dean", "Sonny", "Rex", "Curtis",
        "Lenny", "Cliff", "Tex", "Ace", "Wes", "Roscoe", "Milo", "Baxter", "Reggie", "Deke", "Hutch", "Moe",
    ];

    private static readonly string[] Last =
    [
        "Vaughn", "Sparks", "Rivers", "Knox", "Steele", "Malone", "Wilder", "Fox", "Cassidy", "Monroe", "Hale",
        "Reyes", "Quinn", "Crane", "Bishop", "Harlow", "Sinclair", "Voss", "Mercer", "Winters", "Stone", "Kane",
        "Larue", "Sharp", "Ryder", "Delgado", "Ash",
    ];

    private static readonly string[] Prefix =
    [
        "Midnight", "Velvet", "Neon", "Cosmic", "Downtown", "Uptown", "Lonesome", "Electric", "Wild", "Sweet",
        "Blue", "Diamond", "Shortwave", "Graveyard", "Sundown", "Hurricane", "Boogie", "Dizzy", "Slick", "Big",
    ];

    private static readonly string[] Handle =
    [
        "Static", "Nightbird", "Nightowl", "Wolf", "Needle", "Groove", "Signal", "Deluxe", "Fever", "Thunder",
        "Reverb", "Echo", "Tempo", "Vinyl", "Wavelength", "Dial",
    ];

    /// <summary>A suggestion that differs from <paramref name="exclude"/> where it can.</summary>
    public static string Suggest(string? exclude, Random random)
    {
        ArgumentNullException.ThrowIfNull(random);

        var taken = exclude?.Trim();
        var name = Compose(random);
        for (var attempt = 0; !string.IsNullOrEmpty(taken) && string.Equals(name, taken, StringComparison.OrdinalIgnoreCase) && attempt < 8; attempt++)
        {
            name = Compose(random);
        }

        return name;
    }

    private static string Compose(Random random)
    {
        var first = Pick(First, random);

        // Weighted by repetition, as the web console's list is: three in eight are a plain name.
        return random.Next(8) switch
        {
            3 or 4 => $"{Pick(Prefix, random)} {first}",
            5 => $"{first} {Pick(Handle, random)}",
            6 => $"The {Pick(Handle, random)}",
            7 => $"DJ {Pick(Handle, random)}",
            _ => $"{first} {Pick(Last, random)}",
        };
    }

    private static string Pick(string[] items, Random random) => items[random.Next(items.Length)];
}
