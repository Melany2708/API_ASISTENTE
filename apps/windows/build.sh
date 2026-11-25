#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${ELECTRON_WINDOWS:?Ruta a Electron extraído para Windows x64}"
output="${1:?Ruta absoluta del instalador}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -a "$ELECTRON_WINDOWS" "$work/runtime"
mv "$work/runtime/electron.exe" "$work/runtime/Amelia.exe"
rm -f "$work/runtime/resources/default_app.asar"
mkdir -p "$work/runtime/resources/app"
cp package.json main.js preload.js connection.html connection.css connection.js icon.png "$work/runtime/resources/app/"
python3 - "$work/Amelia.ico" <<'PY'
import pathlib
import struct
import sys

from_png = pathlib.Path('icon.png').read_bytes()
# ICO embeds a 256×256 PNG for modern Windows.
import zlib
def chunk(name, data):
    return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data))
raster = zlib.decompress(from_png[41:-16])
rows = []
for y in range(0, 512, 2):
    row = raster[y * 1537 + 1:(y + 1) * 1537]
    rows.append(b'\0' + b''.join(row[x:x + 3] for x in range(0, len(row), 6)))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 256, 256, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')
icon_header = struct.pack('<HHHBBBBHHII', 0, 1, 1, 0, 0, 0, 0, 1, 24, len(png), 22)
pathlib.Path(sys.argv[1]).write_bytes(icon_header + png)
PY
"${MAKENSIS:-makensis}" -V2 -DAPP_ICON="$work/Amelia.ico" -DAPP_FILES="$work/runtime" -DOUTPUT="$output" installer.nsi
