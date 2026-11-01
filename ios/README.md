# HackerTune for iOS

A thin native shell around https://ht.tunapro.xyz: one full-screen `WKWebView`, built entirely on
GitHub Actions (no Mac needed) and installed through TestFlight internal testing.

- Background audio: `UIBackgroundModes = audio`, `AVAudioSession` category `.playback` (activated at launch,
  re-activated after interruptions). The site's `<audio>` element + Media Session keep playing with the screen off.
- Inline playback, autoplay without a tap, Picture in Picture, AirPlay.
- Persistent cookies (default website data store), so your identity cookie survives restarts.
- Links to other sites open outside the app (YouTube links open the YouTube app if installed); the site and the
  embedded YouTube player stay inside.
- Pull to refresh, offline screen with retry, light/dark follows the system.
- User agent ends in ` HackerTuneApp/1.0`.

Layout: `project.yml` (XcodeGen spec; the `.xcodeproj` is generated in CI and not committed),
`HackerTune/` (Swift sources, `Info.plist`, app icon). Workflow: `.github/workflows/ios.yml`.

## One-time setup (owner)

1. **API key.** [App Store Connect → Users and Access → Integrations → App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
   → Team Keys → generate a key with the **Admin** role (it creates the distribution certificate and the
   provisioning profile in step 5 and uploads builds). Download the `AuthKey_XXXXXXXXXX.p8` (only possible once)
   and note the **Key ID** and the **Issuer ID** shown above the list.
2. **Bundle ID.** [Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list)
   → `+` → App IDs → App → Explicit Bundle ID `xyz.tunapro.hackertune`, description "HackerTune". No capabilities
   needed (background audio is an Info.plist setting, not a capability).
3. **App record.** [App Store Connect → Apps](https://appstoreconnect.apple.com/apps) → `+` → New App: platform iOS,
   name "HackerTune" (must be unique on the App Store; add a suffix if taken), language, bundle ID
   `xyz.tunapro.hackertune`, SKU e.g. `hackertune`. The App Store Connect API cannot create app records, so this
   step is manual.
4. **Team ID.** [developer.apple.com/account](https://developer.apple.com/account) → Membership details → Team ID.
5. **Secrets** (from a machine with `gh` logged in):

   ```sh
   gh secret set ASC_KEY_ID     -R tunapro1234/hackertune --body "XXXXXXXXXX"
   gh secret set ASC_ISSUER_ID  -R tunapro1234/hackertune --body "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   gh secret set ASC_KEY_P8     -R tunapro1234/hackertune < AuthKey_XXXXXXXXXX.p8
   gh secret set APPLE_TEAM_ID  -R tunapro1234/hackertune --body "XXXXXXXXXX"

   # signing: distribution certificate + App Store profile, made with the same API key
   python3 ios/tools/make-signing.py XXXXXXXXXX xxxxxxxx-xxxx-... AuthKey_XXXXXXXXXX.p8 ~/.secrets/hackertune
   base64 -w0 ~/.secrets/hackertune/dist.p12 | gh secret set DIST_CERT_P12 -R tunapro1234/hackertune
   gh secret set DIST_CERT_PASSWORD -R tunapro1234/hackertune < ~/.secrets/hackertune/dist.p12.password
   base64 -w0 ~/.secrets/hackertune/profile.mobileprovision | gh secret set PROFILE_B64 -R tunapro1234/hackertune
   ```

   The certificate and profile expire after a year; run the script again then (revoke the old certificate first).
   Xcode's cloud signing (`-exportArchive -authenticationKey*`) is not used: on a new team it failed with
   "Cannot verify client's JWT headers" while the same key worked against the API.

6. **Build.** Actions → `ios` → Run workflow (or `gh workflow run ios.yml -R tunapro1234/hackertune --ref main`, or push
   a tag `ios-v1.0.0`). The `testflight` job archives with the imported certificate, exports the .ipa and uploads it with `altool`. Processing takes ~5-30 min.
7. **Tester.** App Store Connect → the app → TestFlight → Internal Testing → `+` create a group (e.g. "Me") → add
   yourself (you must be a user on the team, which the account holder already is). Enable automatic distribution so
   new builds arrive by themselves. No export-compliance question: `ITSAppUsesNonExemptEncryption` is `NO`.
8. **Install.** Install the **TestFlight** app on the iPhone, sign in with the same Apple ID, accept the invite and
   install HackerTune. TestFlight builds expire after 90 days; re-run the workflow to get a fresh one.

## Notes

- Build number = workflow run number; marketing version = `MARKETING_VERSION` in `project.yml`.
- Changing the icon: replace `HackerTune/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` (1024×1024 PNG,
  no transparency).
- If background playback stops at the end of a track while the phone is locked (WebKit may refuse to start a new
  `src` in a backgrounded web view), the fix belongs in the site (keep one continuous `<audio>` stream) or in a
  native `AVPlayer` bridge. Test this on the device first: lock the phone, let a track end, check that the next
  one starts.
