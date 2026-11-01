import UIKit
import WebKit

/// Full-screen WKWebView showing https://ht.tunapro.xyz, plus pull-to-refresh and an
/// offline/error screen.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private let refreshControl = UIRefreshControl()
    private let errorView = ErrorView()
    private var failedURL: URL?

    /// Brand background (#ffffff light, #0d0d10 dark; asset "LaunchBackground", also used by the
    /// launch screen), so the status-bar strip and the area behind the page blend in.
    private static let pageBackground = UIColor(named: "LaunchBackground") ?? .systemBackground

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.pageBackground

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()  // persistent cookies (the site's identity cookie)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsPictureInPictureMediaPlayback = true
        config.allowsAirPlayForMediaPlayback = true
        // Appended to WebKit's default ("Mobile/15E148") so the site can detect the app.
        config.applicationNameForUserAgent = (config.applicationNameForUserAgent ?? "Mobile/15E148") + " HackerTuneApp/1.0"

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        webView.isInspectable = true
        webView.isOpaque = false
        webView.backgroundColor = Self.pageBackground
        webView.scrollView.backgroundColor = Self.pageBackground
        // The page uses viewport-fit=cover + env(safe-area-inset-bottom); let CSS handle insets.
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        refreshControl.addTarget(self, action: #selector(pullToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        // Top/sides follow the safe area (the site's header has no safe-area padding);
        // the bottom runs to the screen edge and the page pads it with env(safe-area-inset-bottom).
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        errorView.translatesAutoresizingMaskIntoConstraints = false
        errorView.backgroundColor = Self.pageBackground
        errorView.isHidden = true
        errorView.onRetry = { [weak self] in self?.retry() }
        view.addSubview(errorView)
        NSLayoutConstraint.activate([
            errorView.topAnchor.constraint(equalTo: view.topAnchor),
            errorView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            errorView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            errorView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        NotificationCenter.default.addObserver(self, selector: #selector(didBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)

        webView.load(URLRequest(url: LinkPolicy.home))
    }

    // MARK: - Reload / retry

    @objc private func pullToRefresh() {
        if webView.url == nil { webView.load(URLRequest(url: LinkPolicy.home)) } else { webView.reload() }
    }

    private func retry() {
        let url = failedURL ?? webView.url ?? LinkPolicy.home
        errorView.isLoading = true
        webView.load(URLRequest(url: url))
    }

    @objc private func didBecomeActive() {
        if !errorView.isHidden {
            retry()  // came back online after being away
        } else if webView.url == nil {
            webView.load(URLRequest(url: LinkPolicy.home))  // web content process was killed while suspended
        }
    }

    private func showError(_ message: String, url: URL?) {
        failedURL = url
        refreshControl.endRefreshing()
        errorView.show(message: message)
    }

    private func handle(_ error: Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        // WebKitErrorFrameLoadInterruptedByPolicyChange: we cancelled it ourselves (link opened outside).
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return }
        let url = ns.userInfo[NSURLErrorFailingURLErrorKey] as? URL
        showError(ns.localizedDescription, url: url ?? webView.url)
    }

    private func openOutside(_ url: URL) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let scheme = url.scheme?.lowercased() ?? ""

        if LinkPolicy.isInternalScheme(scheme) { decisionHandler(.allow); return }
        guard scheme == "http" || scheme == "https" else {
            // mailto:, tel:, itms-apps:, youtube: ...
            openOutside(url); decisionHandler(.cancel); return
        }

        guard let target = navigationAction.targetFrame else {
            // target=_blank / window.open: the site in the web view, everything else outside.
            if LinkPolicy.staysInApp(url) { webView.load(navigationAction.request) } else { openOutside(url) }
            decisionHandler(.cancel); return
        }

        // iframes (the embedded YouTube player and everything it loads) are always allowed.
        if !target.isMainFrame { decisionHandler(.allow); return }

        if LinkPolicy.staysInApp(url) {
            decisionHandler(.allow)
        } else {
            openOutside(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.isForMainFrame,
           let http = navigationResponse.response as? HTTPURLResponse,
           (500...599).contains(http.statusCode) {
            // nginx 502/503/504 while the server restarts: show our retry screen instead.
            showError("Sunucu şu an yanıt vermiyor (HTTP \(http.statusCode)).", url: http.url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        failedURL = nil
        errorView.hide()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handle(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        refreshControl.endRefreshing()
        let ns = error as NSError
        // A committed page that fails late is still usable; only report real connectivity loss.
        if ns.domain == NSURLErrorDomain && ns.code != NSURLErrorCancelled { handle(error) }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if webView.url == nil { webView.load(URLRequest(url: LinkPolicy.home)) } else { webView.reload() }
    }

    // MARK: - WKUIDelegate

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if LinkPolicy.staysInApp(url) { webView.load(navigationAction.request) } else { openOutside(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Tamam", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Vazgeç", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Tamam", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Vazgeç", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "Tamam", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        present(alert, animated: true)
    }
}

/// "Can't reach HackerTune" screen with a retry button.
final class ErrorView: UIView {
    var onRetry: (() -> Void)?

    private let detail = UILabel()
    private let button = UIButton(configuration: .filled())
    private let spinner = UIActivityIndicatorView(style: .medium)

    var isLoading = false {
        didSet {
            button.isEnabled = !isLoading
            if isLoading { spinner.startAnimating() } else { spinner.stopAnimating() }
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)

        let icon = UIImageView(image: UIImage(systemName: "wifi.exclamationmark"))
        icon.tintColor = .secondaryLabel
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 44, weight: .regular)

        let title = UILabel()
        title.text = "HackerTune'a ulaşılamıyor"
        title.font = .preferredFont(forTextStyle: .title3)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        title.numberOfLines = 0

        detail.font = .preferredFont(forTextStyle: .subheadline)
        detail.adjustsFontForContentSizeCategory = true
        detail.textColor = .secondaryLabel
        detail.textAlignment = .center
        detail.numberOfLines = 0

        var config = UIButton.Configuration.filled()
        config.title = "Tekrar dene"
        config.baseBackgroundColor = UIColor(red: 0x0f / 255, green: 0x76 / 255, blue: 0x6e / 255, alpha: 1)  // brand teal #0f766e
        config.baseForegroundColor = .white
        config.cornerStyle = .capsule
        button.configuration = config
        button.addAction(UIAction { [weak self] _ in self?.onRetry?() }, for: .primaryActionTriggered)

        let stack = UIStackView(arrangedSubviews: [icon, title, detail, button, spinner])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.setCustomSpacing(24, after: detail)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -32),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(message: String) {
        detail.text = message
        isLoading = false
        isHidden = false
    }

    func hide() {
        isLoading = false
        isHidden = true
    }
}
