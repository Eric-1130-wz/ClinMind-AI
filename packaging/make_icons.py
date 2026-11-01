"""生成 Tauri 需要的图标（本机没有 npm tauri CLI 的图标生成依赖也能走）。

输出到 packaging/tauri/src-tauri/icons/：
  32x32.png / 128x128.png / 128x128@2x.png / icon.png / icon.ico
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent / "tauri" / "src-tauri" / "icons"

BG = (11, 18, 32, 255)
ACCENT = (79, 157, 255, 255)
ACCENT_SOFT = (28, 58, 96, 255)
PULSE = (230, 240, 255, 255)


def draw(size: int) -> Image.Image:
    s = 1024
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 圆角底板
    pad = int(s * 0.06)
    d.rounded_rectangle(
        [pad, pad, s - pad, s - pad], radius=int(s * 0.22), fill=BG, outline=ACCENT_SOFT,
        width=max(2, int(s * 0.012)),
    )

    # 医疗十字
    cx, cy = s // 2, int(s * 0.46)
    arm, thick = int(s * 0.20), int(s * 0.075)
    d.rounded_rectangle(
        [cx - arm, cy - thick, cx + arm, cy + thick],
        radius=thick // 2, fill=ACCENT,
    )
    d.rounded_rectangle(
        [cx - thick, cy - arm, cx + thick, cy + arm],
        radius=thick // 2, fill=ACCENT,
    )

    # 心电折线
    y = int(s * 0.75)
    pts = [
        (int(s * 0.16), y),
        (int(s * 0.34), y),
        (int(s * 0.40), y - int(s * 0.10)),
        (int(s * 0.46), y + int(s * 0.13)),
        (int(s * 0.52), y - int(s * 0.19)),
        (int(s * 0.58), y + int(s * 0.06)),
        (int(s * 0.64), y),
        (int(s * 0.84), y),
    ]
    d.line(pts, fill=PULSE, width=max(3, int(s * 0.028)), joint="curve")

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in [
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 512),
        ("Square30x30Logo.png", 30),
        ("Square44x44Logo.png", 44),
        ("Square71x71Logo.png", 71),
        ("Square89x89Logo.png", 89),
        ("Square107x107Logo.png", 107),
        ("Square142x142Logo.png", 142),
        ("Square150x150Logo.png", 150),
        ("Square284x284Logo.png", 284),
        ("Square310x310Logo.png", 310),
        ("StoreLogo.png", 50),
    ]:
        draw(size).save(OUT / name)

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base = draw(256)
    base.save(OUT / "icon.ico", format="ICO", sizes=ico_sizes)
    print(f"icons -> {OUT}")


if __name__ == "__main__":
    main()
