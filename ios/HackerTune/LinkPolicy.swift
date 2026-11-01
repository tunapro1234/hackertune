import Foundation

/// Decides which top-level URLs stay inside the app and which go to Safari / other apps.
/// Subframe (iframe) navigations are always allowed by WebViewController, so the embedded
/// YouTube player can load whatever it needs; this only applies to the main frame and to
/// new-window requests (target=_blank, window.open).
enum LinkPolicy {
    static let home = URL(string: "https://ht.tunapro.xyz/")!

    /// The site itself (yt.tunapro.xyz is the old name and redirects to ht.tunapro.xyz).
    static let appHosts: Set<String> = ["ht.tunapro.xyz", "yt.tunapro.xyz"]

    /// YouTube player/media hosts that may appear as navigations and must not leave the app.
    private static let mediaHostSuffixes = ["youtube-nocookie.com", "googlevideo.com", "ytimg.com"]
    private static let youtubeHosts: Set<String> = ["youtube.com", "www.youtube.com", "m.youtube.com"]

    static func staysInApp(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        if appHosts.contains(host) { return true }
        if mediaHostSuffixes.contains(where: { host == $0 || host.hasSuffix("." + $0) }) { return true }
        if youtubeHosts.contains(host) && url.path.hasPrefix("/embed") { return true }
        return false
    }

    /// Schemes WebKit handles itself without leaving the page.
    static func isInternalScheme(_ scheme: String) -> Bool {
        ["about", "data", "blob", "javascript"].contains(scheme)
    }
}
