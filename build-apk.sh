#!/usr/bin/env bash
# Baut die Debug-APK. Braucht JDK 21 (Capacitor 7) + Android SDK (Plattform 35).
set -euo pipefail
cd "$(dirname "$0")"

export JAVA_HOME="${JAVA_HOME:-$HOME/.jdks/jdk-21.0.13+9}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/.bubblewrap/android_sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

[ -x "$JAVA_HOME/bin/java" ] || { echo "JDK 21 nicht gefunden unter $JAVA_HOME — JAVA_HOME setzen."; exit 1; }
[ -d "$ANDROID_HOME/platforms" ] || { echo "Android SDK nicht gefunden unter $ANDROID_HOME — ANDROID_HOME setzen."; exit 1; }

npm install
npx cap sync android
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
# Release-Schlüssel liegt nur bei dir (~/.config/monatskasse) und in den CI-Secrets.
# Ohne ihn signiert Gradle mit dem Debug-Schlüssel; so eine APK kann sich nicht selbst updaten.
KEYS="$HOME/.config/monatskasse"
if [ -f "$KEYS/signing.env" ]; then set -a; . "$KEYS/signing.env"; set +a; export SIGNING_STORE_FILE="$KEYS/release.jks"; fi
( cd android && ./gradlew :app:assembleRelease )

cp android/app/build/outputs/apk/release/app-release.apk ./Monatskasse.apk
echo ""
echo "Fertig -> $(pwd)/Monatskasse.apk"
