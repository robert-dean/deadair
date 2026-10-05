import DeadairSdk

/// The presenter's picture, resolved against the station the way a cover is.
///
/// `show.hostArtUrl` is a path under the API root, exactly like a cached cover's `artworkUrl`, so it
/// goes through `StationUrl.artUrl` and nowhere else. Only on air: a face left over from the last
/// presenter would say somebody is talking who is not.
///
/// `naming` is for a place that draws the presenter's name from somewhere other than this reading
/// (Up next's header reads it from the running order). The picture is given only when the reading
/// names the same person, so a recast the poll has not caught up with yet never puts one presenter's
/// face beside another's name.
public func hostPortraitUrl(station: StationUrl?, reading: NowPlaying?, naming name: String? = nil) -> String? {
    guard let reading, reading.onAir, let show = reading.show else { return nil }
    if let name, nonBlank(show.host) != name { return nil }
    return station?.artUrl(show.hostArtUrl)
}

/// The picture for what is on air: the record's cover, or, while the station talks between records,
/// whoever is talking.
///
/// A break has no cover of its own worth showing, and the picture of the person on the mic is what
/// the screen is about while it lasts. A presenter with no picture leaves the break exactly as it was
/// before there were pictures: whatever the break's own `artworkUrl` says, usually nothing. Nothing
/// off air, for the reason the portrait gives.
public func coverArtUrl(station: StationUrl?, reading: NowPlaying?) -> String? {
    guard let reading, reading.onAir, let track = reading.track else { return nil }
    if track.kind == .break, let portrait = hostPortraitUrl(station: station, reading: reading) { return portrait }
    return station?.artUrl(track.artworkUrl)
}
