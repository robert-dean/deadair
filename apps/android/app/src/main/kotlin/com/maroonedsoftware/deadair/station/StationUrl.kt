package com.maroonedsoftware.deadair.station

/**
 * Where a station is, as the listener typed it and as the app has to use it.
 *
 * One origin serves everything: nginx puts the console at the root, proxies the API under `/api`,
 * and proxies the Icecast mounts beside it. So the whole of a station's address is the URL the
 * console loads from, and every other address is derived here rather than configured.
 *
 * Held as text rather than as a parsed URL so this class stays free of `android.*` and of any
 * particular HTTP library, which is what lets it be tested on the JVM.
 */
@JvmInline
value class StationUrl private constructor(val origin: String) {
    /** What the SDK is pointed at. The API's routers are mounted at the root behind this prefix. */
    val apiBase: String get() = "$origin/api"

    /**
     * A mount, from the same-origin path `/nowplaying` reports.
     *
     * `mounts[]` carries a leading slash, but an older station took the MP3 path from text an operator
     * typed (`stream.mount`), so the slash is enforced here rather than assumed.
     */
    fun mountUrl(path: String): String = "$origin/${path.trimStart('/')}"

    /**
     * Resolve an `artworkUrl` to something an image loader can fetch.
     *
     * The station answers one of two things and says which by shape: an absolute URL at the
     * provider's own CDN, for art nothing has cached yet, or a path relative to the API ROOT
     * (`art/<uuid>`) once the station holds its own copy. The API mounts its routers at the root
     * and knows nothing about the `/api` prefix the edge adds, so resolving the relative form is
     * the client's job — the same job `artSrc` does in the console.
     */
    fun artUrl(artworkUrl: String?): String? {
        if (artworkUrl.isNullOrBlank()) return null
        if (ABSOLUTE.matches(artworkUrl)) return artworkUrl
        return "$apiBase/${artworkUrl.trimStart('/')}"
    }

    override fun toString(): String = origin

    companion object {
        private val ABSOLUTE = Regex("^https?://.*", RegexOption.IGNORE_CASE)

        /**
         * Read what somebody typed.
         *
         * Bare hosts get `https://`, because that is what a station on the public internet is and
         * guessing the safer scheme costs a listener on a LAN one word. `http://` is accepted
         * without complaint — the container's own edge is plain HTTP and TLS terminates at
         * whatever the operator put in front, so a LAN install has no other option — and the UI
         * says so rather than this refusing it.
         *
         * A trailing slash is dropped so nothing downstream builds a `//`. A path is KEPT: an
         * operator may have mounted the whole station under one, and throwing it away would make
         * that install unreachable with no way to say why.
         */
        fun parse(input: String): Result<StationUrl> {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return Result.failure(IllegalArgumentException("Enter the station's address"))

            val withScheme = if (trimmed.contains("://")) trimmed else "https://$trimmed"
            if (!ABSOLUTE.matches(withScheme)) {
                return Result.failure(IllegalArgumentException("A station is reached over http or https"))
            }

            val rest = withScheme.substringAfter("://")
            val host = rest.substringBefore('/')
            if (host.isEmpty()) return Result.failure(IllegalArgumentException("Enter the station's address"))

            // Query and fragment are not part of an origin, and a pasted console URL may carry
            // both. Dropping them here means the listener can paste the address bar and be right.
            val path = rest.substringAfter('/', "").substringBefore('?').substringBefore('#').trimEnd('/')
            val scheme = withScheme.substringBefore("://").lowercase()

            return Result.success(StationUrl(if (path.isEmpty()) "$scheme://$host" else "$scheme://$host/$path"))
        }
    }
}
