# hiz_karne.json üretir: hızı bilinen yıldızlarda "yalnız SPHEREx" hız ölçümünün katalogla (Gaia/Hipparcos) karşılaştırması.
# Girdi: canlı sitede her yıldız açılarak toplanan sonuc.json (state.olcum). Kullanım: python3 hiz_karne_uret.py sonuc.json site/hiz_karne.json
import json, sys, math, statistics as st, datetime
R = json.load(open(sys.argv[1], encoding="utf-8"))
Y, olcum_yok, veri_az, belirsiz = [], [], [], []
for ad, r in R.items():
    kat = r["pm"] / 1000; sx = r.get("sx")
    if not sx: (veri_az if (r.get("nsx") or 0) < 3 else olcum_yok).append(ad); continue
    e = {"ad": ad, "kat": round(kat, 3), "kat_pa": r["pa"], "pm": round(sx["pm"], 3), "hata": round(sx["hata"], 3), "pa": round(sx["pa"], 1),
         "n": sx["n"], "mag": r.get("mag"), "yil": [round(sx["yil"][0], 2), round(sx["yil"][1], 2)]}
    e["sapma"] = round(abs(e["pm"] - kat) / max(e["hata"], 1e-6), 2)
    e["dpa"] = round(abs(((e["pa"] - r["pa"]) % 360 + 540) % 360 - 180), 1)
    if e["hata"] > 0.5 * e["pm"]: e["durum"] = "belirsiz"; belirsiz.append(ad)
    else: e["durum"] = "uyumlu" if e["sapma"] <= 2 else "sapiyor"
    Y.append(e)
O = [e for e in Y if e["durum"] != "belirsiz"]
fark = [abs(e["pm"] - e["kat"]) / e["kat"] * 100 for e in O]
oran = [e["pm"] / e["kat"] for e in O]
x = [e["kat"] for e in O]; y = [e["pm"] for e in O]
mx, my = st.mean(x), st.mean(y)
r_ = sum((a - mx) * (b - my) for a, b in zip(x, y)) / math.sqrt(sum((a - mx) ** 2 for a in x) * sum((b - my) ** 2 for b in y))
ozet = {"denenen": len(R), "veri_az": len(veri_az), "sinanan": len(R) - len(veri_az), "olculen": len(O), "belirsiz": len(belirsiz), "olcum_yok": len(olcum_yok),
        "uyumlu": sum(e["durum"] == "uyumlu" for e in O), "medyan_fark": round(st.median(fark), 1), "medyan_oran": round(st.median(oran), 3),
        "medyan_dpa": round(st.median([e["dpa"] for e in O]), 1), "r": round(r_, 3),
        "medyan_hata": round(st.median([e["hata"] for e in O]), 2),
        "yil": [round(min(e["yil"][0] for e in Y), 2), round(max(e["yil"][1] for e in Y), 2)]}
json.dump({"uretim": datetime.date.today().isoformat(), "ozet": ozet, "yildizlar": sorted(Y, key=lambda e: -e["kat"]), "olcum_yok": olcum_yok, "veri_az": veri_az},
          open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
print(json.dumps(ozet, ensure_ascii=False))
