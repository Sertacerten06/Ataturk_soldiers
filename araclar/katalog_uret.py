"""HYG v4.2 CSV'sinden targets.json/targets.js (ArpaSphere hedef kataloğu) ve hyg.js (tüm yıldızlar, yerel arama) üretir.
Kullanım: python3 -I araclar/katalog_uret.py   (depo kökünden)"""
import csv, gzip, json, math, os, re

KOK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")  # çıktılar site/ klasörüne
CSV = os.path.join(os.path.dirname(KOK), "veri", "hygdata_v42.csv.gz")  # HYG v4.2 ham verisi (depoda yok, README'ye bak)
ESKI = os.path.join(KOK, "targets.json")

GREEK = {"Alp":"α","Bet":"β","Gam":"γ","Del":"δ","Eps":"ε","Zet":"ζ","Eta":"η","The":"θ","Iot":"ι","Kap":"κ","Lam":"λ",
         "Mu":"μ","Nu":"ν","Xi":"ξ","Omi":"ο","Pi":"π","Rho":"ρ","Sig":"σ","Tau":"τ","Ups":"υ","Phi":"φ","Chi":"χ","Psi":"ψ","Ome":"ω"}

def num(r, k):
    try: return float(r[k])
    except (ValueError, KeyError): return None

def adlar(r):
    """Yıldızın tüm kimlikleri, tercih sırasına göre."""
    con = r["con"]; ids = []
    if r["proper"]: ids.append(r["proper"])
    b = r["bayer"]
    if b and con:
        m = re.match(r"([A-Z][a-z]{1,2})(?:-?(\d+))?$", b)
        if m and m.group(1) in GREEK:
            ids.append(GREEK[m.group(1)] + (m.group(2) or "") + " " + con)
            ids.append(b + " " + con)
    if r["flam"] and con: ids.append(f'{r["flam"]} {con}')
    if r["var"] and con and not r["var"].isdigit(): ids.append(f'{r["var"]} {con}')
    if r["gl"]: ids.append(re.sub(r"^(Gl|GJ|NN|Wo)\s*", r"\1 ", r["gl"].strip()))
    if r["hd"]: ids.append("HD " + r["hd"])
    if r["hr"]: ids.append("HR " + r["hr"])
    if r["hip"]: ids.append("HIP " + r["hip"])
    out = []
    for i in ids:
        if i not in out: out.append(i)
    return out

def kayit(r):
    pmra, pmdec = num(r, "pmra") or 0, num(r, "pmdec") or 0
    pm = round(math.hypot(pmra, pmdec))
    pa = round(math.degrees(math.atan2(pmra, pmdec))) % 360
    dist = num(r, "dist"); dist = round(dist, 2) if dist and 0 < dist < 100000 else None
    mag = num(r, "mag")
    vmin, vmax = num(r, "var_min"), num(r, "var_max")
    amp = round(abs(vmin - vmax), 2) if vmin is not None and vmax is not None else 0
    ids = adlar(r)
    flags = (1 if pm >= 500 else 0) | (2 if pm >= 200 else 0) | (4 if dist and dist < 25 else 0) \
          | (8 if r["proper"] else 0) | (16 if amp >= 0.5 else 0)
    return [ids[0] if ids else f'HYG {r["id"]}', round(float(r["ra"]) * 15, 5), round(float(r["dec"]), 5),
            pm, pa, dist, mag, r["spect"], r["con"], flags, ids[1:], amp]

rows = [r for r in csv.DictReader(gzip.open(CSV, "rt", encoding="utf-8")) if r["id"] != "0"]
hepsi = [kayit(r) for r in rows]

# Eski katalogdaki elle yazılmış adları, kimlikleri ve notları koru (HIP/HD/Gl ya da konumla eşle)
eski = json.load(open(ESKI, encoding="utf-8"))["stars"] if os.path.exists(ESKI) else []
eski_id = {}
for e in eski:
    for i in [e[0], *e[10]]:
        if re.match(r"(HIP|HD|Gl|GJ) ", i): eski_id.setdefault(i, e)
def eskisi(s):
    for i in [s[0], *s[10]]:
        if i in eski_id: return eski_id[i]
    return None

hedef, eslesen = [], 0
for s in hepsi:
    if not s[9] & (2 | 4 | 8 | 16): continue
    e = eskisi(s)
    if e and abs(e[1] - s[1]) * math.cos(math.radians(s[2])) < 0.01 and abs(e[2] - s[2]) < 0.01:
        eslesen += 1
        ids = [i for i in [s[0], *s[10], *e[10]] if i != e[0]]
        s = [e[0], *s[1:10], list(dict.fromkeys(ids)), s[11]] + ([e[12]] if len(e) > 12 else [])
    hedef.append(s)

# HYG'de olmayan, görevin test hedefleri olan kahverengi cüceler (J2000'e geri taşınmış konumlar)
EK = [
    ["ε Indi B", 331.04383, -56.78269, 4684, 122, 3.64, None, "T1+T6", "Ind", 1 | 2 | 4 | 8,
     ["eps Ind B", "Epsilon Indi B", "eps Indi Ba/Bb", "2MASS J22041052-5646577"], 0,
     "Çift kahverengi cüce (T1+T6), ε Indi A'nın 1460 AB uzağında. Optikte çok sönük, kızılötesinde parlak; ~4.7″/yıl öz hareket."],
    ["WISE 0855−0714", 133.81898, -7.24711, 8146, 275, 2.28, None, "Y4", "Hya", 1 | 2 | 4 | 8,
     ["WISE J085510.83-071442.5", "WISE 0855-0714", "WISE 0855"], 0,
     "Bilinen en soğuk kahverengi cüce (~285 K). Optik taramalarda görünmez; yalnızca 3–5 µm'de (SPHEREx D5–D6) belirir. ~8.1″/yıl batıya."],
]
# HYG'nin öz hareketi bazı hedeflerde eski; Gaia DR3 değeriyle düzelt (ad → [pm mas/yıl, yön derece])
GAIA_PM = {"Barnard's Star": [10393, 356]}  # pmra −801.6, pmdec 10362.4 mas/yıl (Gaia DR3); HYG 10032 veriyordu
for s in hedef:
    if s[0] in GAIA_PM: s[3], s[4] = GAIA_PM[s[0]]
# Hızlı hedeflerin konum/öz hareketi Gaia DR3'ten (HYG ve Gliese konumları farklı epoklarda; site J2000 varsayıyor)
GD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gaia_duzeltme.json")
if os.path.exists(GD):
    _gd = json.load(open(GD, encoding="utf-8"))["hedefler"]
    for s in hedef:
        if s[0] in _gd: s[1], s[2], s[3], s[4] = _gd[s[0]][:4]
ek_ad = {s[0] for s in EK}
hedef = [s for s in hedef if s[0] not in ek_ad] + EK

say = lambda f: sum(1 for s in hedef if s[9] & f)
meta = {"source": "HYG Database v4.2 (astronexus/HYG-Database)", "license": "CC BY-SA 4.0", "epoch": "J2000 konumları (hızlı hedeflerde Gaia DR3'ten, epok 2000'e taşınmış)",
        "fields": ["ad","ra_derece","dec_derece","oz_hareket_mas_yil","hareket_yonu_derece","uzaklik_pc","kadir","tayf",
                   "takimyildiz","bayraklar","diger_adlar","degisim_genligi_kadir","not"],
        "flags": {"1":"hizli (>=500 mas/yil)","2":"yuksek oz hareket (>=200 mas/yil)","4":"yakin (<25 pc)","8":"adli","16":"degisen (genlik >=0.5 kadir)"},
        "counts": {"hpm": say(2), "var": say(16), "fast": say(1), "near": say(4), "named": say(8)}, "total": len(hedef)}
veri = json.dumps({"meta": meta, "stars": hedef}, ensure_ascii=False, separators=(",", ":"))
open(os.path.join(KOK, "targets.json"), "w", encoding="utf-8").write(veri)
open(os.path.join(KOK, "targets.js"), "w", encoding="utf-8").write("window.TARGETS=" + veri + ";\n")
tum = json.dumps(hepsi, ensure_ascii=False, separators=(",", ":"))
open(os.path.join(KOK, "hyg.js"), "w", encoding="utf-8").write("window.HYG=" + tum + ";\n")
print(f"HYG: {len(hepsi)} yıldız · hedef katalog: {len(hedef)} (eskiden korunan: {eslesen}/{len(eski)}) · {meta['counts']}")
