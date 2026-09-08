package com.maroonedsoftware.deadair.ui.catalog

/**
 * The first page of a list, and how many there are in all.
 *
 * The station pages at a hundred at most, and a phone lists rather than paginates: the rare album
 * or artist with more than a hundred says how many it left out rather than offering a pager.
 */
data class Page<T>(val items: List<T>, val total: Long) {
    val notShown: Long get() = (total - items.size).coerceAtLeast(0)
}

/** The most the station will answer in one page. */
const val PAGE_MAX = 100L
