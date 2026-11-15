# UltracoolSheet (Best, Dupuy, Liu ve ark.; Zenodo 10.5281/zenodo.4169084, sürüm 2.1.0, CC BY 4.0) → ultracool.js
# Kaynak dosya: "UltracoolSheet - Main.csv" (3890 M7–Y ultra-soğuk cüce). İndirme:
#   curl -L -o main.csv "https://zenodo.org/api/records/15802304/files/UltracoolSheet%20-%20Main.csv/content"
# Kullanım: python3 araclar/ultracool_uret.py main.csv
# Öncelik: targets.js/HYG > UltracoolSheet > Gaia yakın (gaia_yakin.js). UltracoolSheet'te olan bir cisim Gaia yakın listesinden
# çıkarılır (Gaia'nın renkten tahmini türü yerine ölçülmüş tür ve bilinen ad kalsın); gaia_yakin.js bu yüzden yeniden yazılır.
import csv, json, math, os, sys

B = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
sayi = lambda v: (None if v in ("", "NaN", "nan", None) else float(v))

def yukle_js(fn, anahtar=None):
    t = open(fn, encoding="utf-8").read(); i = t.index("=") + 1
    d = json.loads(t[i:].strip().rstrip(";"))
    return d[anahtar] if anahtar else d

def izgara_kur(L):
    g = {}
    for r in L: g.setdefault((int(r[1] * 100), int(r[2] * 100)), []).append(r)
    return g

def bul(g, ra, dec, tol):
    cd = math.cos(math.radians(dec))
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for r in g.get((int(ra * 100) + i, int(dec * 100) + j), []):
                if math.hypot((r[1] - ra) * cd, r[2] - dec) < tol: return r
    return None

eski = izgara_kur(yukle_js(os.path.join(B, "targets.js"), "stars") + yukle_js(os.path.join(B, "hyg.js")))
gaia = yukle_js(os.path.join(B, "gaia_yakin.js")); gaia_g = izgara_kur(gaia); gaia_sil = set()

out, ayni = [], 0
for o in csv.DictReader(open(sys.argv[1], encoding="utf-8", errors="replace")):
    ra, dec = sayi(o["ra_j2000_formula"]), sayi(o["dec_j2000_formula"])
    if ra is None or dec is None: continue
    pmra, pmdec = sayi(o["pmra_formula"]) or 0, sayi(o["pmdec_formula"]) or 0
    pm = math.hypot(pmra, pmdec)
    # konumlar çeşitli epoklardan (2MASS ~2000, WISE ~2010…): pay hareketle büyür
    tol = (6 + pm / 1000 * 15) / 3600
    if bul(eski, ra, dec, tol): ayni += 1; continue
    g = bul(gaia_g, ra, dec, tol)
    if g: gaia_sil.add(g[0])
    opt, ir = (o["spt_opt"] or "").strip(), (o["spt_ir"] or "").strip()
    bos = ("nan", "null", "none", "")
    opt = "" if opt.lower() in bos else opt; ir = "" if ir.lower() in bos else ir
    sp = ir if (ir[:1] in "TY" or not opt) else opt          # T/Y türleri kızılötesinde tanımlı
    n = sayi(o["sptnum_formula"])                               # sayısal tür: M0=0, L0=10, T0=20, Y0=30
    if not sp and n is not None: sp = "~" + "MLTY"[min(3, max(0, int(n // 10)))] + f"{n % 10:g}"
    dist = sayi(o["dist_formula"]); J = sayi(o["J_2MASS"]) or sayi(o["J_MKO"])
    fl = (1 if pm >= 500 else 0) | (2 if pm >= 200 else 0) | (4 if dist and dist < 25 else 0) | 8
    ids = [x for x in {o["name_simbadable"], o.get("designation_2mass", "")} if x and x.lower() != "nan" and x != o["name"]]
    out.append([o["name"].strip(), round(ra, 5), round(dec, 5), round(pm), round((math.degrees(math.atan2(pmra, pmdec)) + 360) % 360),
                round(dist, 2) if dist else None, round(J, 2) if J is not None else None, sp, "", fl, ids, 0, ""])

with open(os.path.join(B, "ultracool.js"), "w", encoding="utf-8") as f:
    f.write("window.ULTRACOOL=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
if gaia_sil:
    kalan = [r for r in gaia if r[0] not in gaia_sil]
    with open(os.path.join(B, "gaia_yakin.js"), "w", encoding="utf-8") as f:
        f.write("window.GAIA_YAKIN=" + json.dumps(kalan, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(f"{len(out)} UltracoolSheet cismi yazıldı ({ayni} tanesi HYG/katalogda vardı); Gaia yakın listesinden {len(gaia_sil)} kopya çıkarıldı")
from collections import Counter
print(Counter((r[7] or "?")[:1] for r in out).most_common())
