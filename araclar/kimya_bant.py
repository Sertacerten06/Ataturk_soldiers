# SPHEREx spektrumunda molekül bantlarının derinliği (sayfadaki kimyaAnaliz() ile aynı yöntem).
# Kullanım: python3 kimya_bant.py spektrum_klasoru   (araclar/spektrum_olc.py çıktısı: her yıldız için {"olcum":[{wl,f,e,ok,sat},…]})
#
# Derinlik = 1 − (bant içindeki medyan akı) / (iki yandaki sürekliliğin bant merkezine güç yasasıyla taşınmış değeri).
# Tek yanı olan bantta süreklilik Rayleigh–Jeans eğimiyle (Fν ∝ λ⁻²) taşınır. Belirsizlik: pencerelerdeki saçılmadan.
import glob, json, math, os, statistics as st, sys

# ad, bant penceresi, sol süreklilik, sağ süreklilik (µm; None = yok)
# CO 2,3 µm ve CO₂ 4,3 µm de denendi; kalibrasyonda güvenilmez çıktı (bkz. site/index.html KIMYA_BANT açıklaması)
BANTLAR = [
    ("H2O_1.4", (1.33, 1.48), (1.20, 1.30), (1.55, 1.75)),
    ("H2O_1.9", (1.80, 1.98), (1.55, 1.75), (2.05, 2.25)),
    ("CH4_3.3", (3.15, 3.45), (2.55, 2.85), (3.80, 4.15)),
    ("CO_4.6",  (4.55, 4.85), (3.95, 4.15), None),
]

def pencere(P, lo, hi):
    v = [p["f"] for p in P if lo <= p["wl"] <= hi]
    if len(v) < 2: return None
    m = st.median(v); mad = st.median([abs(x - m) for x in v]) * 1.4826
    return m, max(mad / math.sqrt(len(v)), 1e-9), math.sqrt(lo * hi), len(v)

def analiz(olcum):
    P = [p for p in olcum if p.get("ok") and not p.get("sat") and p.get("wl") and p.get("f") and p["f"] > 0 and (not p.get("e") or p["f"] / p["e"] >= 3)]
    out = {}
    for ad, b, l, r in BANTLAR:
        B, L, R = pencere(P, *b), pencere(P, *l), (pencere(P, *r) if r else None)
        if not B or not L or (r and not R): out[ad] = None; continue
        if R:  # iki yan: log F – log λ düzleminde doğru
            s = (math.log(R[0]) - math.log(L[0])) / (math.log(R[2]) - math.log(L[2]))
            c = L[0] * (B[2] / L[2]) ** s
            ce = math.hypot(L[1] / L[0], R[1] / R[0]) * c
        else:  # tek yan: Rayleigh–Jeans eğimi
            c = L[0] * (B[2] / L[2]) ** -2; ce = L[1] / L[0] * c
        d = 1 - B[0] / c
        e = math.hypot(B[1] / c, B[0] * ce / c ** 2)
        out[ad] = (d, e, B[3])
    return out

if __name__ == "__main__":
    for fn in sorted(glob.glob(os.path.join(sys.argv[1], "*.json"))):
        s = json.load(open(fn)); a = analiz(s["olcum"])
        print(f'{s["ad"][:26]:26s} {s.get("sp",""):7s} ' + "  ".join(
            f'{k}:{"—":>12s}' if v is None else f'{k}:{v[0]*100:5.0f}±{v[1]*100:3.0f}%' for k, v in a.items()))
