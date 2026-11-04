#!/usr/bin/env bash
# Rendert die SVG-Quellen in die Android-Mipmaps. Braucht rsvg-convert.
set -euo pipefail
cd "$(dirname "$0")"
RES=../../android/app/src/main/res
for pair in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  d=${pair%%:*}; s=${pair##*:}
  fg=$(python3 -c "print(round(108*$s))"); lg=$(python3 -c "print(round(48*$s))")
  mkdir -p "$RES/mipmap-$d"
  rsvg-convert -w "$fg" -h "$fg" foreground.svg     -o "$RES/mipmap-$d/ic_launcher_foreground.png"
  rsvg-convert -w "$fg" -h "$fg" monochrome.svg     -o "$RES/mipmap-$d/ic_launcher_monochrome.png"
  rsvg-convert -w "$lg" -h "$lg" legacy-square.svg  -o "$RES/mipmap-$d/ic_launcher.png"
  rsvg-convert -w "$lg" -h "$lg" legacy-round.svg   -o "$RES/mipmap-$d/ic_launcher_round.png"
done
rsvg-convert -w 512 -h 512 legacy-square.svg -o icon-512.png
# Web-App: gerundete Icons für Browser, randlose für iPhone (rundet selbst) und Android-"maskable"
WEB=../../www/icons; mkdir -p "$WEB"
sed 's/<rect x="11" y="11" width="86" height="86" rx="20"/<rect x="9" y="9" width="90" height="90"/' legacy-square.svg > /tmp/monatskasse-full.svg
rsvg-convert -w 192 -h 192 legacy-square.svg -o "$WEB/icon-192.png"
rsvg-convert -w 512 -h 512 legacy-square.svg -o "$WEB/icon-512.png"
rsvg-convert -w 180 -h 180 /tmp/monatskasse-full.svg -o "$WEB/apple-touch-icon.png"
rsvg-convert -w 512 -h 512 /tmp/monatskasse-full.svg -o "$WEB/icon-maskable.png"
echo "Icons fertig."
