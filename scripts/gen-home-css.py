from pathlib import Path

root = Path(__file__).resolve().parent.parent
b64 = (Path(__file__).resolve().parent / "_zicon_b64.txt").read_text().strip()
url = f"data:image/png;base64,{b64}"

home = f"""/* Zcord Home button — fond noir + logo Z */
[data-list-item-id="guildsnav___home"] [class*="childWrapper_"],
[data-list-item-id="guildsnav___home"] div[class*="wrapper_"][class*="childWrapper_"] {{
    position: relative !important;
    background-color: #0b0b0b !important;
    background-image: url("{url}") !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
    background-size: 62% !important;
    overflow: visible !important;
}}

[data-list-item-id="guildsnav___home"] [class*="childWrapper_"] > svg,
[data-list-item-id="guildsnav___home"] [class*="childWrapper_"] > img:not(.zc-home-logo),
[data-list-item-id="guildsnav___home"] [class*="childWrapper_"] svg {{
    opacity: 0 !important;
    visibility: hidden !important;
    width: 0 !important;
    height: 0 !important;
}}

[data-list-item-id="guildsnav___home"] [class*="lowerBadge_"],
[data-list-item-id="guildsnav___home"] [class*="upperBadge_"],
[data-list-item-id="guildsnav___home"] [class*="numberBadge_"],
[data-list-item-id="guildsnav___home"] [class*="iconBadge_"] {{
    z-index: 10 !important;
    opacity: 1 !important;
    visibility: visible !important;
}}
"""

out = root / "src" / "plugins" / "_core" / "zcordHomeIcon.css"
out.write_text(home, encoding="utf-8")
print("wrote", out, "bytes", out.stat().st_size)
