# TiviBro for Android

The phone app for TiviBro on LG webOS TVs: finds your TV, pairs with it once, opens TiviBro and the web editor full screen, and turns the TV on.  Kotlin and Jetpack Compose, Android 8 and later.

- `app/src/main/java/app/tivibro/phone/proto/`: the protocol (pairing, signed requests, discovery, Wake-on-LAN), plain JVM code.  See [Phone app protocol](../docs/wiki/Phone-app-protocol.md).
- `data/TvStore.kt`: paired TVs and their keys, encrypted with a key in the Android Keystore, kept out of backups.
- `ui/`: the screens.  `tile/`: the Quick Settings tile.

## Building

CI builds it (`.github/workflows/android.yml`): unit tests, then a pairing test against the TV's real helper code (`tests/android/fake-tv.js` runs `service/companion.js`), then the APKs, kept as a workflow artifact.  On a TiviBro release tag, the APK is added to the release.

Locally, with JDK 17, Gradle 8.11 and the Android SDK:

```
cd android
gradle assembleDebug                         # app/build/outputs/apk/debug/
node ../tests/android/fake-tv.js > /tmp/tv.txt &  TB_FAKE_TV=$(cat /tmp/tv.txt) gradle testDebugUnitTest
```

The debug key in `app/debug.keystore` is public on purpose, like Android's own: it only lets one test build install over another.  Release builds from this repository are signed with TiviBro's own key, from the repository's secrets (`TB_KEYSTORE_B64`, `TB_KEYSTORE_PASS`, `TB_KEY_ALIAS`, `TB_KEY_PASS`); its fingerprint is in `site/.well-known/assetlinks.json`, which lets the TV's QR code open the app.  Builds without the secrets (pull requests from forks) use the test key.
