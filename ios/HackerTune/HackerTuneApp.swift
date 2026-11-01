import AVFoundation
import SwiftUI

@main
struct HackerTuneApp: App {
    init() {
        AudioSession.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea()  // WebViewController lays itself out against the safe area
        }
    }
}

/// SwiftUI wrapper around the UIKit controller that owns the WKWebView.
struct WebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}

/// App-wide audio session: `.playback` so the site's <audio> keeps playing with the screen
/// locked or the app in the background (together with UIBackgroundModes = audio in Info.plist).
final class AudioSession: NSObject {
    static let shared = AudioSession()

    func start() {
        activate()
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        center.addObserver(self, selector: #selector(interrupted(_:)),
                           name: AVAudioSession.interruptionNotification, object: session)
        center.addObserver(self, selector: #selector(mediaServicesReset(_:)),
                           name: AVAudioSession.mediaServicesWereResetNotification, object: session)
    }

    func activate() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            NSLog("HackerTune: audio session setup failed: \(error)")
        }
    }

    /// After a phone call / Siri / alarm ends, make the session active again so the
    /// lock-screen play button (Media Session in the page) can resume playback.
    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    /// Apple: after a media services reset, all audio objects must be reconfigured.
    @objc private func mediaServicesReset(_ note: Notification) {
        activate()
    }
}
