# Usage: pip install fonttools brotli; python3 community/web/scripts/make-digit-fonts.py community/web/public/fonts
# Build digits-only Atkinson subsets whose zero has no slash (U12). Outer contour kept; the two
# slashed counters become one oval counter: the outer contour scaled into their combined box.
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.recordingPen import RecordingPen, DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools import subset

def contours(rec):
    out, cur = [], []
    for op, args in rec.value:
        cur.append((op, args))
        if op in ("closePath", "endPath"):
            out.append(cur); cur = []
    return out

def bounds(c, gs):
    bp = BoundsPen(gs)
    for op, args in c: getattr(bp, op)(*args)
    return bp.bounds

def build(src, dst, family):
    f = TTFont(src)
    gs = f.getGlyphSet()
    rec = RecordingPen(); gs["zero"].draw(rec)
    cs = contours(rec)
    bs = [bounds(c, gs) for c in cs]
    area = lambda b: (b[2]-b[0])*(b[3]-b[1])
    oi = max(range(len(cs)), key=lambda i: area(bs[i]))
    outer, ob = cs[oi], bs[oi]
    inner = [bs[i] for i in range(len(cs)) if i != oi]
    ib = (min(b[0] for b in inner), min(b[1] for b in inner), max(b[2] for b in inner), max(b[3] for b in inner))
    sx = (ib[2]-ib[0]) / (ob[2]-ob[0]); sy = (ib[3]-ib[1]) / (ob[3]-ob[1])
    ocx, ocy = (ob[0]+ob[2])/2, (ob[1]+ob[3])/2
    icx, icy = (ib[0]+ib[2])/2, (ib[1]+ib[3])/2
    pen = TTGlyphPen(gs)
    for op, args in outer: getattr(pen, op)(*args)
    tp = TransformPen(ReverseContourPen(pen), (sx, 0, 0, sy, icx - sx*ocx, icy - sy*ocy))
    for op, args in outer: getattr(tp, op)(*args)
    g = pen.glyph()
    f["glyf"]["zero"] = g
    if "zero.tf" in f["glyf"].glyphs:
        f["glyf"]["zero.tf"] = pen.glyph()
    g.recalcBounds(f["glyf"])
    for rec_ in f["name"].names:
        if rec_.nameID in (1, 4, 16):
            rec_.string = family + ("" if rec_.nameID != 4 else "")
    opts = subset.Options(); opts.flavor = "woff2"; opts.layout_features = ["tnum", "pnum"]; opts.name_IDs = ["*"]
    s = subset.Subsetter(opts); s.populate(unicodes=range(0x30, 0x3A)); s.subset(f)
    f.flavor = "woff2"; f.save(dst)

d = sys.argv[1]
build(f"{d}/atkinson-400.woff2", f"{d}/atkinson-digits-400.woff2", "Atkinson Digits")
build(f"{d}/atkinson-700.woff2", f"{d}/atkinson-digits-700.woff2", "Atkinson Digits")
