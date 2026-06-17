#!/usr/bin/env python3
"""
Kvak app icon generator (PIL only, no SVG toolchain needed).
Kvak = a frog's call. Icon: a glossy frog face on a vibrant teal squircle.
Renders a 4K supersampled master, downsamples (LANCZOS) to every iOS+Android size.
Run:  python3 tools/gen_icon.py
"""
import os, json
from PIL import Image, ImageDraw, ImageFilter

S = 4096  # supersample master

# --- palette ---
BG_TOP   = (60, 216, 193)
BG_MID   = (28, 172, 156)
BG_BOT   = (9, 82, 74)
GLOW     = (150, 245, 228)
WHITE    = (255, 255, 255)
HEAD_LO  = (205, 211, 219)   # subtle shading at head bottom
PUPIL    = (12, 60, 52)
PUPIN2   = (26, 110, 96)     # pupil ring highlight
CATCH    = (255, 255, 255)
MOUTH    = (11, 74, 64)
LIP_HI   = (40, 150, 132)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vgrad(size, top, mid, bot):
    g = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / size
        if t < 0.5:
            g.putpixel((0, y), lerp(top, mid, t / 0.5))
        else:
            g.putpixel((0, y), lerp(mid, bot, (t - 0.5) / 0.5))
    return g.resize((size, size))

def rr_mask(size, box, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius=radius, fill=255)
    return m

def ellipse_mask(size, box, feather=0):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse(box, fill=255)
    if feather:
        m = m.filter(ImageFilter.GaussianBlur(feather))
    return m

def alpha_layer(size, color, mask, alpha_mul=1.0):
    out = Image.new("RGBA", (size, size), color + (0,))
    a = mask.point(lambda v: min(255, int(v * alpha_mul))) if alpha_mul != 1.0 else mask
    out.putalpha(a)
    return out

def build_master():
    n = S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # ---- 1. background gradient (teal->deep), masked to squircle ----
    base = vgrad(n, BG_TOP, BG_MID, BG_BOT)
    img.paste(base, (0, 0), rr_mask(n, [0, 0, n - 1, n - 1], int(n * 0.225)))

    # ---- 2. soft radial glow behind the head (depth) ----
    cx = cy = n * 0.5
    g = ellipse_mask(n, [cx - n*0.34, cy - n*0.30, cx + n*0.34, cy + n*0.30], feather=n*0.06)
    img = Image.alpha_composite(img, alpha_layer(n, GLOW, g, 0.42))

    # ---- 3. head squircle box + drop shadow ----
    hb = [n*0.205, n*0.405, n*0.795, n*0.815]
    hr = n * 0.135
    sh_box = [hb[0] + n*0.010, hb[1] + n*0.022, hb[2] + n*0.010, hb[3] + n*0.022]
    shadow = alpha_layer(n, (0, 0, 0), rr_mask(n, sh_box, hr), 0.40)
    shadow = shadow.filter(ImageFilter.GaussianBlur(n * 0.016))
    img = Image.alpha_composite(img, shadow)

    # ---- 4. head fill (white -> faint cool gray bottom for volume) ----
    headfill = vgrad(n, WHITE, (232, 236, 242), HEAD_LO)
    hf = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    hf.paste(headfill, (0, 0), rr_mask(n, hb, hr))
    img = Image.alpha_composite(img, hf)

    # faint top edge highlight on head (rim light)
    rim = ellipse_mask(n, [hb[0]+n*0.03, hb[1]-n*0.01, hb[2]-n*0.03, hb[1]+n*0.10], feather=n*0.02)
    img = Image.alpha_composite(img, alpha_layer(n, (255,255,255), rim, 0.30))

    # ---- 5. eyes (two glossy bulbs straddling the head top) ----
    eye_cx = [n*0.352, n*0.648]
    eye_cy = n * 0.400
    eye_r  = n * 0.138
    pup_r  = n * 0.072
    for cx in eye_cx:
        # soft shadow under the bulge
        bsh = ellipse_mask(n, [cx-eye_r+n*0.012, eye_cy-eye_r+n*0.04, cx+eye_r+n*0.012, eye_cy+eye_r+n*0.05], feather=n*0.022)
        img = Image.alpha_composite(img, alpha_layer(n, (0,0,0), bsh, 0.18))
        # sclera
        img = Image.alpha_composite(img, alpha_layer(n, WHITE, ellipse_mask(n, [cx-eye_r, eye_cy-eye_r, cx+eye_r, eye_cy+eye_r])))
        # bottom inner shadow (gives sphere depth)
        bsh2 = ellipse_mask(n, [cx-eye_r, eye_cy+n*0.005, cx+eye_r, eye_cy+eye_r], feather=n*0.03)
        img = Image.alpha_composite(img, alpha_layer(n, (180,196,206), bsh2, 0.55))
        # pupil
        img = Image.alpha_composite(img, alpha_layer(n, PUPIL, ellipse_mask(n, [cx-pup_r, eye_cy-pup_r, cx+pup_r, eye_cy+pup_r])))
        # pupil rim glow
        img = Image.alpha_composite(img, alpha_layer(n, PUPIN2, ellipse_mask(n, [cx-pup_r-n*0.006, eye_cy-pup_r-n*0.006, cx+pup_r+n*0.006, eye_cy+pup_r+n*0.006], feather=n*0.012), 0.35))
        # big catchlight (top-left)
        cr = n*0.026; ox, oy = -n*0.028, -n*0.034
        img = Image.alpha_composite(img, alpha_layer(n, CATCH, ellipse_mask(n, [cx+ox-cr, eye_cy+oy-cr, cx+ox+cr, eye_cy+oy+cr])))
        # tiny catchlight (bottom-right)
        cr2 = n*0.012; ox2, oy2 = n*0.030, n*0.032
        img = Image.alpha_composite(img, alpha_layer(n, (220,235,230), ellipse_mask(n, [cx+ox2-cr2, eye_cy+oy2-cr2, cx+ox2+cr2, eye_cy+oy2+cr2]), 0.8))

    # ---- 6. smile (thick upward arc, with a lighter lip line) ----
    mcx, mcy, mr = n*0.500, n*0.575, n*0.165
    bbox = [mcx-mr, mcy-mr, mcx+mr, mcy+mr]
    # outer dark stroke
    smile = Image.new("RGBA", (n, n), (0,0,0,0))
    sd = ImageDraw.Draw(smile)
    sd.arc(bbox, start=20, end=160, fill=MOUTH, width=int(n*0.046))
    smile = smile.filter(ImageFilter.GaussianBlur(n*0.002))
    img = Image.alpha_composite(img, smile)
    # subtle lip highlight just above the arc
    lip = Image.new("RGBA", (n, n), (0,0,0,0))
    ld = ImageDraw.Draw(lip)
    ld.arc([bbox[0], bbox[1]-n*0.012, bbox[2], bbox[3]-n*0.012], start=20, end=160, fill=LIP_HI, width=int(n*0.012))
    lip = lip.filter(ImageFilter.GaussianBlur(n*0.004))
    img = Image.alpha_composite(img, alpha_layer(n, LIP_HI, lip.split()[3], 0.6))

    # ---- 7. glossy specular sweep across top of whole icon ----
    sweep = Image.new("L", (n, n), 0)
    wd = ImageDraw.Draw(sweep)
    wd.pieslice([-n*0.1, -n*0.95, n*1.1, n*0.15], 180, 360, fill=255)
    sweep = sweep.filter(ImageFilter.GaussianBlur(n*0.05))
    img = Image.alpha_composite(img, alpha_layer(n, WHITE, sweep, 0.16))

    # ---- 8. subtle vignette (darken edges) ----
    vig = Image.new("L", (n, n), 0)
    vd = ImageDraw.Draw(vig)
    vd.rectangle([0,0,n,n], fill=0)
    vm = ellipse_mask(n, [-n*0.18,-n*0.18, n*1.18, n*1.18], feather=n*0.06)
    vm = vm.point(lambda v: 255-v)
    img = Image.alpha_composite(img, alpha_layer(n, (0,0,0), vm, 0.28))

    return img

def scaled(master, px, circle=False):
    out = master.resize((px, px), Image.LANCZOS)
    if circle:
        m = ellipse_mask(px, [0, 0, px, px])
        r = Image.new("RGBA", (px, px), (0,0,0,0))
        r.paste(out, (0,0), m)
        out = r
    return out

def main():
    tools = os.path.dirname(os.path.abspath(__file__))
    mobile = os.path.dirname(tools)
    master = build_master().filter(ImageFilter.SMOOTH_MORE)

    # ---- Android legacy mipmaps ----
    ares = os.path.join(mobile, "android/app/src/main/res")
    for dens, px in {"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}.items():
        d = os.path.join(ares, f"mipmap-{dens}")
        scaled(master, px).save(os.path.join(d, "ic_launcher.png"))
        scaled(master, px, circle=True).save(os.path.join(d, "ic_launcher_round.png"))

    # ---- iOS AppIcon.appiconset ----
    ios_dir = os.path.join(mobile, "ios/Kvak/Images.xcassets/AppIcon.appiconset")
    for fn, px in [("icon_20pt@2x",40),("icon_20pt@3x",60),("icon_29pt@2x",58),
                   ("icon_29pt@3x",87),("icon_40pt@2x",80),("icon_40pt@3x",120),
                   ("icon_60pt@2x",120),("icon_60pt@3x",180),("icon_1024",1024)]:
        scaled(master, px).save(os.path.join(ios_dir, f"{fn}.png"))
    def e(pt, idi, sc, fn):
        return {"size":f"{pt}x{pt}","idiom":idi,"scale":f"{sc}x","filename":fn,"role":"primary"}
    contents = {"images":[
        e(20,"iphone",2,"icon_20pt@2x.png"), e(20,"iphone",3,"icon_20pt@3x.png"),
        e(29,"iphone",2,"icon_29pt@2x.png"), e(29,"iphone",3,"icon_29pt@3x.png"),
        e(40,"iphone",2,"icon_40pt@2x.png"), e(40,"iphone",3,"icon_40pt@3x.png"),
        e(60,"iphone",2,"icon_60pt@2x.png"), e(60,"iphone",3,"icon_60pt@3x.png"),
        e(1024,"ios-marketing",1,"icon_1024.png")],
        "info":{"author":"xcode","version":1}}
    with open(os.path.join(ios_dir, "Contents.json"), "w") as f:
        json.dump(contents, f, indent=2)
    print("OK: Kvak icons generated (Android 5 densities x2, iOS 9 sizes)")

if __name__ == "__main__":
    main()
