options {
    keys: {
        area: music
    }
}

contract Artist: {
    id: readonly uuid
    name: string
    rating: int(min=-1, max=1) = 0
}

contract Album: {
    id: readonly uuid
    name: string
    artistId: readonly uuid
    rating: int(min=-1, max=1) = 0
}

contract Track: {
    id: readonly uuid
    title: string
    artistId: readonly uuid
    albumId: readonly uuid
    rating: int(min=-1, max=1) = 0
}