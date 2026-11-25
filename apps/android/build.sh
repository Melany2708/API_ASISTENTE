#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${ANDROID_JAR:?Ruta a android.jar de la API 35}"
: "${ANDROID_BUILD_TOOLS:?Ruta a build-tools 35}"
: "${AMELIA_KEYSTORE:?Ruta al keystore de firma}"
: "${AMELIA_KEY_PASSWORD:?Contraseña del keystore}"
output="${1:-Amelia-Android.apk}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/classes"
"$ANDROID_BUILD_TOOLS/aapt2" compile --dir res -o "$work/resources.zip"
"$ANDROID_BUILD_TOOLS/aapt2" link -I "$ANDROID_JAR" --manifest AndroidManifest.xml \
  --java "$work" --version-code 1 --version-name 1.0.0 -o "$work/resources.apk" "$work/resources.zip"
javac -source 8 -target 8 -classpath "$ANDROID_JAR" -d "$work/classes" $(find src "$work/com" -name '*.java')
jar cf "$work/classes.jar" -C "$work/classes" .
"$ANDROID_BUILD_TOOLS/d8" --min-api 26 --lib "$ANDROID_JAR" --output "$work" "$work/classes.jar"
(cd "$work" && zip -q resources.apk classes.dex)
"$ANDROID_BUILD_TOOLS/zipalign" -f -p 4 "$work/resources.apk" "$work/aligned.apk"
"$ANDROID_BUILD_TOOLS/apksigner" sign --ks "$AMELIA_KEYSTORE" --ks-key-alias amelia \
  --ks-pass env:AMELIA_KEY_PASSWORD --out "$output" "$work/aligned.apk"
"$ANDROID_BUILD_TOOLS/apksigner" verify --verbose "$output"
rm -f "$output.idsig"
