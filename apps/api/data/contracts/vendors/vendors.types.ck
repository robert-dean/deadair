options {
    keys: {
        area: vendors
    }
 }

 contract SpotifyCallbackQuery: {
    code?: string(max=2048)
    state?: string(max=200)
    error?: string(max=200)
 }