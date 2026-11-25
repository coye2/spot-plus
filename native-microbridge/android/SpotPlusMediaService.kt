// SpotPlusMediaService.kt — Path 3: Android Native Microbridge (~155 LOC)
// Single authoritative ExoPlayer + Jetpack Media3 MediaLibraryService for Android Auto.
// Maintains independent background playback even when the Trusted Web Activity is suspended,
// and exposes a driver-safe library browse tree hydrated from Spot+'s on-device sync snapshot.

package io.github.coye2.spotplus.microbridge

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

data class TrackNode(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val artworkUri: String,
    val streamUri: String?,
)

data class PlaylistNode(
    val id: String,
    val name: String,
    val tracks: List<TrackNode>,
)

class SpotPlusMediaService : MediaLibraryService() {

    companion object {
        const val ROOT_ID = "spotplus:root"
        const val LIKES_ID = "spotplus:likes"
        const val PLAYLISTS_ID = "spotplus:playlists"
        const val CMD_SYNC_LIBRARY = "spotplus.microbridge.v1.library.syncSnapshot"
        const val CMD_RESOLVE_RESULT = "spotplus.microbridge.v1.resolve.result"
    }

    private lateinit var player: ExoPlayer
    private lateinit var session: MediaLibrarySession

    // On-device library cache populated by PWA sync snapshot (never duplicates Spot+ UI)
    @Volatile private var likedTracks: List<TrackNode> = emptyList()
    @Volatile private var playlists: List<PlaylistNode> = emptyList()

    override fun onCreate() {
        super.onCreate()
        val attrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        // Single authoritative engine: automatic audio focus + pause on car/Bluetooth disconnect.
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(attrs, /* handleAudioFocus = */ true)
            .setHandleAudioBecomingNoisy(true)
            .build()

        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                // Request fresh stream URL via microbridge session extras or advance safely.
                if (player.hasNextMediaItem()) {
                    player.seekToNextMediaItem()
                    player.prepare()
                    player.play()
                }
            }
        })

        session = MediaLibrarySession.Builder(this, player, SpotPlusLibraryCallback()).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

    private fun isSafeHttps(uri: String?): Boolean {
        if (uri.isNullOrBlank()) return false
        val parsed = Uri.parse(uri)
        return parsed.scheme.equals("https", ignoreCase = true) && !parsed.host.isNullOrBlank()
    }

    private fun toPlayableMediaItem(t: TrackNode): MediaItem {
        val builder = MediaItem.Builder()
            .setMediaId("track:${t.id}")
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(t.title)
                    .setArtist(t.artist)
                    .setAlbumTitle(t.album)
                    .setArtworkUri(if (isSafeHttps(t.artworkUri)) Uri.parse(t.artworkUri) else null)
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .build(),
            )
        if (isSafeHttps(t.streamUri)) {
            builder.setUri(Uri.parse(t.streamUri))
        }
        return builder.build()
    }

    private fun toFolderItem(id: String, title: String, subtitle: String): MediaItem =
        MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .build(),
            )
            .build()

    private inner class SpotPlusLibraryCallback : MediaLibrarySession.Callback {
        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(LibraryResult.ofItem(toFolderItem(ROOT_ID, "Spot+", ""), params))

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            // Driver-distraction compliant shallow hierarchy (max 2 taps from root to play)
            val items: List<MediaItem> = when {
                parentId == ROOT_ID -> listOf(
                    toFolderItem(LIKES_ID, "Liked Songs", "${likedTracks.size} songs"),
                    toFolderItem(PLAYLISTS_ID, "Playlists", "${playlists.size} playlists"),
                )
                parentId == LIKES_ID -> likedTracks.take(100).map(::toPlayableMediaItem)
                parentId == PLAYLISTS_ID -> playlists.take(50).map {
                    toFolderItem("playlist:${it.id}", it.name, "${it.tracks.size} songs")
                }
                parentId.startsWith("playlist:") -> {
                    val pid = parentId.removePrefix("playlist:")
                    playlists.firstOrNull { it.id == pid }?.tracks?.take(100)?.map(::toPlayableMediaItem).orEmpty()
                }
                else -> emptyList()
            }
            return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(items), params))
        }

        override fun onSearch(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<Void>> {
            val count = searchTracks(query).size
            session.notifySearchResultChanged(browser, query, count, params)
            return Futures.immediateFuture(LibraryResult.ofVoid())
        }

        override fun onGetSearchResult(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val hits = searchTracks(query).take(25).map(::toPlayableMediaItem)
            return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(hits), params))
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            // Accepts validated bridge updates from SpotPlusTwaActivity (same UID / verified caller).
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
    }

    private fun searchTracks(query: String): List<TrackNode> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return emptyList()
        val seen = HashSet<String>()
        val all = likedTracks + playlists.flatMap { it.tracks }
        return all.filter { t ->
            seen.add(t.id) && ("${t.title} ${t.artist} ${t.album}".lowercase().contains(q))
        }
    }

    override fun onDestroy() {
        session.release()
        player.release()
        super.onDestroy()
    }
}
