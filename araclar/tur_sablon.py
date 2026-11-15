# SPHEREx spektrumlarından K/M cüceleri ve L/T kahverengi cüceler için tür tayini: referanslardan şablon, birini-dışarıda-bırak doğrulaması.
# Kullanım: python3 siniflandir.py std_spek[,bd_spek] [hedef_spek] [sablon_cikti.json]
#   Tür sayısı: K0=0 … K7=7, M0=8 … M9=17, L0=18 … L9=27, T0=28 …; referans bilgileri std_sec.json ve (varsa) bd_sec.json
import json, glob, math, os, sys, statistics as st

NB = 24; LO, HI = math.log(0.75), math.log(5.0)
EDGES = [math.exp(LO + (HI - LO) * i / NB) for i in range(NB + 1)]
MID = [math.sqrt(EDGES[i] * EDGES[i + 1]) for i in range(NB)]

def tip_ad(t):
    t = round(t * 2) / 2
    return (f"K{t:g}" if t < 8 else f"M{t - 8:g}" if t < 18 else f"L{t - 18:g}" if t < 28 else f"T{t - 28:g}") + ("V" if t < 18 else "")

def binned(s):
    """Spektrumu ortak ızgaraya topla: her bantta medyan log10(akı); temiz olmayan ölçümleri at."""
    B = [[] for _ in range(NB)]
    for p in s["olcum"]:
        if not p.get("ok") or p.get("sat") or p.get("wl") is None or not p.get("f") or p["f"] <= 0: continue
        if p.get("e") and p["f"] / p["e"] < 5: continue
        i = int((math.log(p["wl"]) - LO) / (HI - LO) * NB)
        if 0 <= i < NB: B[i].append(math.log10(p["f"]))
    v = [st.median(b) if len(b) >= 1 else None for b in B]
    return v, [len(b) for b in B]

def shape(v):
    """Şekil: ortalaması çıkarılmış log akı (yalnız ölçülen bantlar)."""
    xs = [x for x in v if x is not None]
    if len(xs) < NB * 0.5: return None
    m = sum(xs) / len(xs)
    return [None if x is None else x - m for x in v]

def dist(a, b):
    """İki şekil arasında, ortak bantlarda ölçek serbest (ofset çıkarılarak) ortalama kare fark."""
    pr = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pr) < 8: return float("inf")
    off = sum(x - y for x, y in pr) / len(pr)
    return sum((x - y - off) ** 2 for x, y in pr) / len(pr)

def templates(stars):
    T = {}
    for s in stars: T.setdefault(s["tip"], []).append(s["sh"])
    out = {}
    for t, L in T.items():
        out[t] = [st.median([x[i] for x in L if x[i] is not None]) if any(x[i] is not None for x in L) else None for i in range(NB)]
    return out

def classify(sh, T):
    ts = sorted(T); d = [dist(sh, T[t]) for t in ts]
    k = min(range(len(ts)), key=lambda i: d[i])
    best = ts[k]
    if 0 < k < len(ts) - 1:  # parabolik ara değer (komşu sınıflarla)
        x0, x1, x2 = ts[k - 1], ts[k], ts[k + 1]; y0, y1, y2 = d[k - 1], d[k], d[k + 1]
        den = (x0 - x1) * (x0 - x2) * (x1 - x2)
        A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den
        Bc = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den
        if A > 0: best = min(max(-Bc / (2 * A), x0), x2)
    return best, d[k], dict(zip(ts, d))

def load(folder):
    S = []
    for fn in sorted(glob.glob(os.path.join(folder, "*.json"))):
        s = json.load(open(fn)); v, n = binned(s); sh = shape(v)
        if sh is None: print("  yetersiz ölçüm:", s["ad"], sum(1 for x in v if x is not None), "bant"); continue
        s["sh"] = sh; s["nb"] = n; S.append(s)
    return S

REF = sys.argv[1].split(",")
std = [s for f in REF for s in load(f)]
# SIMBAD türleri (çoğu kalite C) yer yer yanlış: Gaia BP−RP rengi kendi sınıfının medyanından >0,35 kadir sapanı at
KOK = os.path.dirname(REF[0].rstrip("/")) or "."
meta = {}
for f in ("std_sec.json", "bd_sec.json"):
    if os.path.exists(os.path.join(KOK, f)): meta.update({x["ad"]: x for x in json.load(open(os.path.join(KOK, f)))})
for s in std: s.update({k: meta.get(s["ad"], {}).get(k) for k in ("bp_rp", "MG")})
byT = {}
for s in meta.values():  # sınıf medyanı seçilen tüm yıldızlardan (spektrumu yetersiz olanlar dahil)
    if s.get("bp_rp") is not None: byT.setdefault(s["tip"], []).append(s["bp_rp"])
medc = {t: st.median(v) for t, v in byT.items()}
# K/M referanslarında Gaia rengi şart; kahverengi cüceler (M9 ve sonrası) Gaia'da çoğunlukla yok, onlar renk denetimsiz kalır
drop = [s for s in std if (s.get("bp_rp") is None and s["tip"] < 17) or (s.get("bp_rp") is not None and s["tip"] in medc and abs(s["bp_rp"] - medc[s["tip"]]) > 0.35)]
for s in drop: print(f'  atıldı (renk tutarsız): {s["ad"]} {s["sp"]} BP−RP {s.get("bp_rp")} (sınıf medyanı {medc.get(s["tip"])})')
std = [s for s in std if s not in drop]
# Kirlenme denetimi: SPHEREx'in J (1,15–1,35 µm) ya da K (2,0–2,35 µm) akısı katalog (2MASS) değerinin 2 katını aşıyorsa
# açıklığa parlak bir komşu girmiştir; o referans atılır. (Düşük oran fizik olabilir: T cücelerinde K bandındaki metan.)
def bant_medyan(P, lo, hi):
    v = [p["f"] for p in P if p.get("ok") and not p.get("sat") and p.get("wl") and lo <= p["wl"] <= hi and p.get("f", 0) > 0]
    return st.median(v) if len(v) >= 2 else None
kirli = []
for s in std:
    m = meta.get(s["ad"], {}); J, K = m.get("J"), m.get("K")
    rj = (bant_medyan(s["olcum"], 1.15, 1.35) or 0) / (1594e6 * 10 ** (-J / 2.5)) if J else 0
    rk = (bant_medyan(s["olcum"], 2.0, 2.35) or 0) / (666.7e6 * 10 ** (-K / 2.5)) if K else 0
    if rj > 2 or rk > 2: kirli.append(s); print(f'  atıldı (komşu ışığı, J oranı {rj:.1f}, K oranı {rk:.1f}): {s["ad"]} {s["sp"]}')
std = [s for s in std if s not in kirli]
print(f"{len(std)} referans yıldız kullanılabilir")
# Gaia rengi → tür (aynı temiz referanslardan; hedeflerde bağımsız çapraz kontrol)
CR = sorted((st.median([s["bp_rp"] for s in std if s["tip"] == t and s.get("bp_rp") is not None]), t) for t in sorted({s["tip"] for s in std if s.get("bp_rp") is not None and s["tip"] < 17}))
def gaia_tip(c):
    if c is None: return None
    if c <= CR[0][0]: return CR[0][1]
    if c >= CR[-1][0]: return CR[-1][1]
    for (c0, t0), (c1, t1) in zip(CR, CR[1:]):
        if c0 <= c <= c1: return t0 + (t1 - t0) * (c - c0) / ((c1 - c0) or 1)
# Birini-dışarıda-bırak
res = []
for i, s in enumerate(std):
    T = templates([x for j, x in enumerate(std) if j != i])
    t, d, _ = classify(s["sh"], T); res.append((s, t, d))
    print(f'  {s["ad"]:28s} katalog {s["sp"]:8s} → SPHEREx {tip_ad(t):7s} (fark {t - s["tip"]:+.1f} alt tür, uyum {d:.4f})')
err = [t - s["tip"] for s, t, d in res]
rms = math.sqrt(sum(e * e for e in err) / len(err)); mad = st.median([abs(e) for e in err])
print(f"Doğrulama: RMS {rms:.2f} alt tür, medyan mutlak fark {mad:.2f}, ±1 içinde {sum(abs(e)<=1 for e in err)}/{len(err)}, ±2 içinde {sum(abs(e)<=2 for e in err)}/{len(err)}")
M = [(s, t) for s, t, d in res if 8 <= s["tip"] < 18]
if M: print(f"  yalnız M cüceleri: RMS {math.sqrt(sum((t-s['tip'])**2 for s,t in M)/len(M)):.2f}")
LT = [(s, t) for s, t, d in res if s["tip"] >= 18]
if LT: print(f"  yalnız L/T kahverengi cüceler: RMS {math.sqrt(sum((t-s['tip'])**2 for s,t in LT)/len(LT)):.2f}, ±2 içinde {sum(abs(t-s['tip'])<=2 for s,t in LT)}/{len(LT)}")

T = templates(std)
if len(sys.argv) > 3:
    json.dump({"bantlar": [round(x, 4) for x in MID], "kenar": [round(x, 4) for x in EDGES],
               "sablon": {tip_ad(t): [None if x is None else round(x, 4) for x in v] for t, v in sorted(T.items())},
               "tip": {tip_ad(t): t for t in T}, "dogrulama": {"rms": round(rms, 2), "mad": round(mad, 2), "n": len(err)}},
              open(sys.argv[3], "w"))
if len(sys.argv) > 2 and os.path.isdir(sys.argv[2]):
    print("\nHedefler:"); sonuc = []
    for s in load(sys.argv[2]):
        t, d, D = classify(s["sh"], T)
        g = gaia_tip(s.get("bp_rp"))
        s["sx_tip"], s["gaia_tip"] = t, g
        print(f'  {s["ad"]:28s} → SPHEREx {tip_ad(t):7s} | Gaia rengi (BP−RP {s.get("bp_rp")}) {tip_ad(g) if g is not None else "—":7s} fark {t-(g or t):+.1f} | M_G {s.get("MG")} d {s.get("dist")} pc | uyum {d:.4f}')
        sonuc.append({k: s.get(k) for k in ("ad", "cw", "ra", "dec", "w2", "bp_rp", "MG", "dist", "sx_tip", "gaia_tip")} | {"sx": tip_ad(t), "gaia": tip_ad(g) if g is not None else None, "uyum": round(d, 5)})
    json.dump(sonuc, open(os.path.join(sys.argv[2], "..", "tur_sonuc.json"), "w"), indent=1)
