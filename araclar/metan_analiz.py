# T/Y kahverengi cücelerde SPHEREx metan (3,3 µm) ve su (1,4 µm) bant derinliği → metan.json (bulgular.html'nin "metan" bölümü).
# Kullanım: python3 araclar/metan_analiz.py <spektrum klasörü> <liste.json>
#   spektrum klasörü: araclar/spektrum_olc.py çıktısı; liste.json: aynı cisimlerin UltracoolSheet bilgileri (ad, sp, w2, dist, …)
# Bant derinliği araclar/kimya_bant.py ile aynı yöntem; SPHEREx türü site/index.html'deki şablonlarla (turTahmin ile aynı hesap).
import json, math, os, re, sys, statistics as st, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kimya_bant import analiz

B = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
TUR = json.loads(re.search(r"const TUR=(\{[^\n]*\});", open(os.path.join(B, "index.html"), encoding="utf-8").read()).group(1))

def tur_tahmin(olcum):
    NB = len(TUR["bantlar"]); lo, hi = math.log(TUR["kenar"][0]), math.log(TUR["kenar"][NB]); Bn = [[] for _ in range(NB)]
    for p in olcum:
        if not p.get("ok") or p.get("sat") or not p.get("f") or p["f"] <= 0 or p.get("wl") is None or (p.get("e") and p["f"] / p["e"] < 5): continue
        i = int((math.log(p["wl"]) - lo) / (hi - lo) * NB)
        if 0 <= i < NB: Bn[i].append(math.log10(p["f"]))
    v = [st.median(b) if b else None for b in Bn]; xs = [x for x in v if x is not None]
    if len(xs) < NB * 0.5: return None
    m = sum(xs) / len(xs); sh = [None if x is None else x - m for x in v]
    def dist(t):
        pr = [(x, y) for x, y in zip(sh, t) if x is not None and y is not None]
        if len(pr) < 8: return float("inf")
        off = sum(x - y for x, y in pr) / len(pr); return sum((x - y - off) ** 2 for x, y in pr) / len(pr)
    ad = sorted(TUR["sablon"], key=lambda a: TUR["tip"][a]); D = [dist(TUR["sablon"][a]) for a in ad]
    k = min(range(len(ad)), key=lambda i: D[i]); t = TUR["tip"][ad[k]]
    if 0 < k < len(ad) - 1:
        (x0, x1, x2), (y0, y1, y2) = [TUR["tip"][ad[i]] for i in (k - 1, k, k + 1)], [D[i] for i in (k - 1, k, k + 1)]
        den = (x0 - x1) * (x0 - x2) * (x1 - x2); A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den
        Bc = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den
        if A > 0: t = min(max(-Bc / (2 * A), x0), x2)
    return t

def tip_ad(t):
    r = round(t * 2) / 2
    return f"K{r:g}V" if r < 8 else f"M{r-8:g}V" if r < 18 else f"L{r-18:g}" if r < 28 else f"T{r-28:g}"

def katalog_no(sp):  # T0=0 … T9=9, Y0=10 …; tür yoksa None
    m = re.match(r"\s*([TY])\s*(\d+(?:\.\d)?)?", sp or "")
    return None if not m else (0 if m.group(1) == "T" else 10) + float(m.group(2) or 0)

def spearman(x, y):
    def sira(a):
        o = sorted(range(len(a)), key=lambda i: a[i]); r = [0] * len(a); i = 0
        while i < len(o):
            j = i
            while j + 1 < len(o) and a[o[j + 1]] == a[o[i]]: j += 1
            for k in range(i, j + 1): r[o[k]] = (i + j) / 2
            i = j + 1
        return r
    rx, ry = sira(x), sira(y); mx, my = st.mean(rx), st.mean(ry)
    return sum((a - mx) * (b - my) for a, b in zip(rx, ry)) / math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))

meta = {x["ad"]: x for x in json.load(open(sys.argv[2]))}
C = []
for fn in sorted(os.listdir(sys.argv[1])):
    s = json.load(open(os.path.join(sys.argv[1], fn))); m = meta.get(s["ad"])
    if not m: continue
    K = analiz(s["olcum"]); ch4, h2o = K.get("CH4_3.3"), K.get("H2O_1.4")
    t = tur_tahmin(s["olcum"]); temiz = sum(1 for p in s["olcum"] if p.get("ok") and not p.get("sat"))
    ep = 2000.0; pmra, pmdec = m["pmra"], m["pmdec"]
    C.append({"ad": s["ad"], "sp": m["sp"], "kat_no": katalog_no(m["sp"]), "w2": m["w2"], "dist": m.get("dist") and round(m["dist"], 2),
              "ch4": None if not ch4 else round(ch4[0] * 100, 1), "ch4_e": None if not ch4 else round(ch4[1] * 100, 1),
              "h2o": None if not h2o else round(h2o[0] * 100, 1), "h2o_e": None if not h2o else round(h2o[1] * 100, 1),
              "sx_tip": None if t is None else round(t, 2), "sx_ad": None if t is None else tip_ad(t), "olcum": len(s["olcum"]), "temiz": temiz,
              "ra2000": m["ra"], "dec2000": m["dec"], "pm": round(math.hypot(pmra, pmdec)), "pa": round((math.degrees(math.atan2(pmra, pmdec)) + 360) % 360)})

# güvenilir ölçüm: metan bandı ölçülmüş, belirsizliği ≤ %10 ve en az 3σ ile sıfırdan ayrılıyor ya da açıkça sıfır
iyi = [c for c in C if c["ch4"] is not None and c["ch4_e"] is not None and c["ch4_e"] <= 10]
sira = sorted([c for c in iyi if c["ch4"] / max(c["ch4_e"], 0.5) >= 3], key=lambda c: -c["ch4"])
for i, c in enumerate(sira): c["sira"] = i + 1
kor = [c for c in iyi if c["kat_no"] is not None]
rho = spearman([c["kat_no"] for c in kor], [c["ch4"] for c in kor]) if len(kor) > 5 else None
# erken T (T0–T3) ile geç T (T6+) karşılaştırması: metan geç türde daha güçlü olmalı
erken = [c["ch4"] for c in kor if c["kat_no"] < 4]; gec = [c["ch4"] for c in kor if 6 <= c["kat_no"] < 10]
out = {"uretim": datetime.date.today().isoformat(), "olculen": len(C), "guvenilir": len(iyi), "sirali": len(sira),
       "spearman": None if rho is None else round(rho, 2), "kor_n": len(kor),
       "erken_med": round(st.median(erken), 1) if erken else None, "erken_n": len(erken),
       "gec_med": round(st.median(gec), 1) if gec else None, "gec_n": len(gec),
       "cisimler": sorted(C, key=lambda c: (c.get("sira") or 999, -(c["ch4"] or -99)))}
json.dump(out, open(os.path.join(B, "metan.json"), "w"), ensure_ascii=False, indent=0)
print(f'{len(C)} ölçüldü, {len(iyi)} güvenilir, {len(sira)} sıralandı · Spearman (katalog T alt türü – metan) ρ = {out["spearman"]} (n={len(kor)})')
print(f'erken T medyan metan %{out["erken_med"]} (n={len(erken)}) · geç T %{out["gec_med"]} (n={len(gec)})')
for c in sira[:12]: print(f'  {c["sira"]:2d}. {c["ad"][:30]:30s} {c["sp"]:9s} metan %{c["ch4"]:5.1f}±{c["ch4_e"]:4.1f}  su %{c["h2o"]}  SPHEREx {c["sx_ad"]}  W2 {c["w2"]}  {c["dist"]} pc')
