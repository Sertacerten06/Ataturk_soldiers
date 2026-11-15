# Gaia DR3 yakın yıldızları (≤50 pc) → gaia_yakin.js; HYG ve targets.js'te olanlar konumdan eşleştirilip atılır.
# Veri: IRSA TAP, gaia_dr3_source WHERE parallax > 20 AND parallax_over_error > 10 AND ruwe < 2 (2026-11-05: 40 436 satır)
#   curl -s "https://irsa.ipac.caltech.edu/TAP/sync" --data-urlencode "QUERY=SELECT source_id, ra, dec, pmra, pmdec, parallax,
#        phot_g_mean_mag, bp_rp, phot_variable_flag FROM gaia_dr3_source WHERE parallax > 20 AND parallax_over_error > 10 AND ruwe < 2"
#        --data-urlencode "FORMAT=csv" -o gaia50.csv
# Kullanım: python3 araclar/gaia_yakin_uret.py gaia50.csv   (çıktı site/gaia_yakin.js)
# Satır biçimi targets.js / hyg.js ile aynı: [ad, ra, dec, öz hareket mas/yıl, yön °, uzaklık pc, kadir, tayf, takımyıldız, bayraklar, diğer adlar, genlik, not]
import csv, json, math, os, sys

B = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")

# Anakol cüceleri için Gaia BP−RP → tayf türü (Pecaut & Mamajek tablosu, yuvarlatılmış). Tür "~" ile işaretlenir: tahmini.
RENK = [(-0.10, "B8"), (0.00, "A0"), (0.15, "A5"), (0.38, "F0"), (0.56, "F5"), (0.73, "G0"), (0.82, "G2"), (0.89, "G5"),
        (0.98, "K0"), (1.09, "K2"), (1.23, "K3"), (1.37, "K4"), (1.47, "K5"), (1.74, "K7"), (1.84, "M0"), (2.03, "M1"),
        (2.24, "M2"), (2.50, "M3"), (2.84, "M4"), (3.29, "M5"), (3.84, "M6"), (4.20, "M7"), (4.49, "M8"), (4.65, "M9"), (4.90, "L0")]

def tayf(bprp, MG):
    if bprp is None: return ""
    if MG > 2.9 * bprp + 8 and bprp < 1.8: return "~beyaz cüce"   # anakolun çok altında
    best = min(RENK, key=lambda r: abs(r[0] - bprp))
    return "~" + best[1] + ("V" if best[1][0] != "L" else "")

def yukle_js(fn, anahtar=None):
    t = open(fn, encoding="utf-8").read(); i = t.index("=") + 1
    d = json.loads(t[i:].strip().rstrip(";"))
    return d[anahtar] if anahtar else d

# mevcut yıldızların J2000 konumları: 0,01°'lik ızgara
var = yukle_js(os.path.join(B, "targets.js"), "stars") + yukle_js(os.path.join(B, "hyg.js"))
izgara = {}
for r in var:
    izgara.setdefault((int(r[1] * 100), int(r[2] * 100)), []).append((r[1], r[2]))

def var_mi(ra, dec, pm):
    # HYG konumları çoğunlukla Hipparcos epoğunda (1991.25); J2000'e taşınmış Gaia konumuyla ~9 yıllık hareket kadar fark olabilir
    tol = (6 + pm / 1000 * 12) / 3600
    cd = math.cos(math.radians(dec))
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for a, d in izgara.get((int(ra * 100) + i, int(dec * 100) + j), []):
                if math.hypot((a - ra) * cd, d - dec) < tol: return True
    return False

out, atla = [], 0
for o in csv.DictReader(open(sys.argv[1])):
    plx = float(o["parallax"]); pmra = float(o["pmra"] or 0); pmdec = float(o["pmdec"] or 0)
    dec = float(o["dec"]); cd = math.cos(math.radians(dec))
    ra2000 = (float(o["ra"]) - pmra / 3.6e6 * 16 / cd) % 360; dec2000 = dec - pmdec / 3.6e6 * 16
    pm = math.hypot(pmra, pmdec)
    if var_mi(ra2000, dec2000, pm): atla += 1; continue
    G = float(o["phot_g_mean_mag"]) if o["phot_g_mean_mag"] else None
    bprp = float(o["bp_rp"]) if o["bp_rp"] else None
    dist = 1000 / plx; MG = G + 5 * math.log10(plx / 100) if G is not None else 99
    fl = (1 if pm >= 500 else 0) | (2 if pm >= 200 else 0) | (4 if dist < 25 else 0) | (16 if o["phot_variable_flag"] == "VARIABLE" else 0)
    out.append(["Gaia DR3 " + o["source_id"], round(ra2000, 5), round(dec2000, 5), round(pm), round((math.degrees(math.atan2(pmra, pmdec)) + 360) % 360),
                round(dist, 2), round(G, 2) if G is not None else None, tayf(bprp, MG), "", fl, [], 0, ""])

with open(os.path.join(B, "gaia_yakin.js"), "w", encoding="utf-8") as f:
    f.write("window.GAIA_YAKIN=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(f"{len(out)} yeni yıldız yazıldı, {atla} tanesi HYG/katalogda zaten vardı")
from collections import Counter
print(Counter(r[7][:2] for r in out).most_common(12))
