"""Download the three web fonts and build a self-hosted stylesheet.

    python3 scripts/fetch-fonts.py

The interface used to load Space Grotesk, Inter and Vazirmatn from Google
Fonts. That is a problem for a server with no route to the public internet --
the fonts simply never arrive, and Vazirmatn is the Farsi face, so Farsi text
is what suffers. It also made every page load wait on a third party, and told
that third party who was visiting.

This downloads the font files into frontend/src/assets/fonts/ and writes
frontend/src/styles/fonts.css pointing at them, so they are served from the
same origin as everything else and the Content-Security-Policy needs no
third-party exceptions.

Re-run it to pick up a font update or to add a weight -- edit FAMILIES below
first. It needs internet access, which is why the result is committed rather
than generated at build time: the build must work on an isolated network.
"""
import re
import subprocess
from pathlib import Path

OUT_FONTS = Path("/home/user/USO-Platform/frontend/src/assets/fonts")
OUT_CSS = Path("/home/user/USO-Platform/frontend/src/styles/fonts.css")

# A modern browser UA, so Google returns woff2 rather than older formats.
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

FAMILIES = [
    ("Space Grotesk", "Space+Grotesk:wght@400;500;600;700"),
    ("Inter", "Inter:wght@400;450;500;600"),
    ("Vazirmatn", "Vazirmatn:wght@400;500;600;700"),
]


def fetch(url: str) -> str:
    return subprocess.run(
        ["curl", "-sS", "-A", UA, url], capture_output=True, text=True, check=True
    ).stdout


def download(url: str, dest: Path) -> None:
    subprocess.run(["curl", "-sS", "-o", str(dest), url], check=True)


OUT_FONTS.mkdir(parents=True, exist_ok=True)

blocks = []
seen: dict[str, str] = {}
total = 0

for name, query in FAMILIES:
    css = fetch(f"https://fonts.googleapis.com/css2?family={query}&display=swap")

    # Each @font-face block carries a subset comment before it; keep them, they
    # explain what the unicode-range is for.
    for url in re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", css):
        if url in seen:
            continue
        slug = name.lower().replace(" ", "-")
        filename = f"{slug}-{len(seen):03d}.woff2"
        download(url, OUT_FONTS / filename)
        seen[url] = filename
        total += 1

    for url, filename in seen.items():
        css = css.replace(f"url({url})", f"url(../assets/fonts/{filename})")

    blocks.append(f"/* ===== {name} ===== */\n{css.strip()}")

header = '''/* Self-hosted web fonts.
 *
 * These used to be two @import lines pointing at fonts.googleapis.com. That
 * broke the interface on a server with no route to the public internet -- and
 * Vazirmatn is the Farsi font, so Farsi text was what suffered most. It also
 * meant every page load waited on a third party, and told that third party who
 * was visiting.
 *
 * The files live in src/assets/fonts/ and are bundled by Vite, so they are
 * served from the same origin as everything else. The unicode-range rules are
 * kept exactly as Google generated them: a browser downloads only the subsets
 * it actually needs, so the Arabic subset is not fetched for a Latin-only page.
 *
 * To update a font, or add a weight, re-run the generator:
 *     python3 scripts/fetch-fonts.py
 */

'''

OUT_CSS.write_text(header + "\n\n".join(blocks) + "\n")

size = sum(f.stat().st_size for f in OUT_FONTS.glob("*.woff2"))
print(f"downloaded {total} font files, {size / 1024:.0f} KB total")
print(f"wrote {OUT_CSS}")
