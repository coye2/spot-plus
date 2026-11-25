// CarPlaySceneDelegate.swift — Path 3: Minimal Apple CarPlay Template Delegate (~75 LOC)
// Exposes Spot+'s synced Library, Playlists, and Now Playing through Apple's approved CarPlay
// audio templates while respecting CarPlay driver-distraction list limits and template depth.

import CarPlay
import UIKit

final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController

        let likesTab = buildLikesTemplate()
        likesTab.tabTitle = "Liked"
        likesTab.tabImage = UIImage(systemName: "heart.fill")

        let playlistsTab = buildPlaylistsTemplate()
        playlistsTab.tabTitle = "Playlists"
        playlistsTab.tabImage = UIImage(systemName: "music.note.list")

        let tabBar = CPTabBarTemplate(templates: [likesTab, playlistsTab])
        interfaceController.setRootTemplate(tabBar, animated: true, completion: nil)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        self.interfaceController = nil
    }

    private func buildLikesTemplate() -> CPListTemplate {
        let engine = NativeAudioEngine.shared
        // Respect Apple CarPlay maximum list item guidance.
        let items = engine.likedTracks.prefix(CPListTemplate.maximumItemCount).enumerated().map { idx, track -> CPListItem in
            let item = CPListItem(text: track.title, detailText: track.artist)
            item.handler = { [weak self] _, completion in
                engine.setQueue(engine.likedTracks, startIndex: idx, autoplay: true)
                self?.interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
                completion()
            }
            return item
        }
        return CPListTemplate(title: "Liked Songs", sections: [CPListSection(items: items)])
    }

    private func buildPlaylistsTemplate() -> CPListTemplate {
        let engine = NativeAudioEngine.shared
        let items = engine.playlists.prefix(CPListTemplate.maximumItemCount).map { playlist -> CPListItem in
            let item = CPListItem(text: playlist.name, detailText: "\(playlist.tracks.count) songs")
            item.handler = { [weak self] _, completion in
                let trackItems = playlist.tracks.prefix(CPListTemplate.maximumItemCount).enumerated().map { idx, track -> CPListItem in
                    let row = CPListItem(text: track.title, detailText: track.artist)
                    row.handler = { [weak self] _, done in
                        engine.setQueue(playlist.tracks, startIndex: idx, autoplay: true)
                        self?.interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
                        done()
                    }
                    return row
                }
                let detail = CPListTemplate(title: playlist.name, sections: [CPListSection(items: trackItems)])
                self?.interfaceController?.pushTemplate(detail, animated: true, completion: nil)
                completion()
            }
            return item
        }
        return CPListTemplate(title: "Playlists", sections: [CPListSection(items: items)])
    }
}
