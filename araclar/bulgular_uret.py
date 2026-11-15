# bulgular.json üretir (bulgular.html'nin verisi): geniş tarama özeti + "türü yok" yıldızların SPHEREx tür tahmini.
# Kullanım: python3 bulgular_uret.py <kesif klasörü> <çıktı bulgular.json>
#   kesif klasörü: genis.json (tarama), genis_hedef.json (Gaia bilgili hedefler), std_spek/ (referans spektrumlar),
#   std_sec.json (referanslar + Gaia rengi), genis_spek/ ve hedef_spek/ (hedef spektrumları), tur_sablon.py (bu klasörde siniflandir.py)
import json, math, os, sys, subprocess, statistics as st, datetime

K, OUT = sys.argv[1], sys.argv[2]
J = lambda f: json.load(open(os.path.join(K, f), encoding="utf-8"))

# 1) Tür tayini: siniflandir.py hedef klasörünü sınıflar, tur_sonuc.json yazar (klasörün bir üstüne)
sonuc = []
for klasor in ("hedef_spek", "genis_spek"):
    if not os.path.isdir(os.path.join(K, klasor)): continue
    subprocess.run([sys.executable, "-I", os.path.join(K, "siniflandir.py"), os.path.join(K, "std_spek") + "," + os.path.join(K, "bd_spek"), os.path.join(K, klasor)],
                   check=True, capture_output=True, cwd=K)
    sonuc += J("tur_sonuc.json")

# 2) Gaia rengi → tür: siniflandir.py ile aynı temiz referanslardan (sınıf medyanından 0,35 kadirden fazla sapan atılır)
ref = J("std_sec.json"); byT = {}
for s in ref:
    if s.get("bp_rp") is not None: byT.setdefault(s["tip"], []).append(s["bp_rp"])
medc = {t: st.median(v) for t, v in byT.items()}
temiz = [s for s in ref if s.get("bp_rp") is not None and abs(s["bp_rp"] - medc[s["tip"]]) <= 0.35]
CR = sorted((st.median([s["bp_rp"] for s in temiz if s["tip"] == t]), t) for t in sorted({s["tip"] for s in temiz}))
def gaia_tip(c):
    if c is None: return None
    if c <= CR[0][0]: return CR[0][1]
    if c >= CR[-1][0]: return CR[-1][1]
    for (c0, t0), (c1, t1) in zip(CR, CR[1:]):
        if c0 <= c <= c1: return t0 + (t1 - t0) * (c - c0) / ((c1 - c0) or 1)

# 3) Hedef bilgileri (Gaia rengi, uzaklık, hız) ile birleştir
meta = {}
for f in ("hedef.json", "genis_hedef.json"):
    if os.path.exists(os.path.join(K, f)):
        for h in J(f): meta[h["ad"].replace("  ", " ")] = h
Y, gor = [], set()
for r in sonuc:
    ad = r["ad"].replace("  ", " ")
    if ad in gor or ad not in meta: continue
    gor.add(ad); h = meta[ad]
    pmra, pmdec = h["pmra"], h["pmdec"]; pm = math.hypot(pmra, pmdec)
    vtan = h.get("vtan") or (round(4.74 * pm / (1000 / h["dist"])) if h.get("dist") else None)
    t = 2000 - h["ep"]; cd = math.cos(math.radians(h["dec"]))
    Y.append({"ad": ad, "sx_tip": round(r["sx_tip"], 2), "gaia_tip": None if gaia_tip(h.get("bp_rp")) is None else round(gaia_tip(h.get("bp_rp")), 2),
              "bp_rp": h.get("bp_rp"), "dist": h.get("dist"), "vtan": vtan, "w2": h.get("w2"), "uyum": r.get("uyum"),
              "hale": bool(vtan and vtan > 200 and (h.get("plx_snr") or 99) > 5),
              "ra2000": h["ra"] + pmra / 3.6e6 * t / cd, "dec2000": h["dec"] + pmdec / 3.6e6 * t, "pm": pm,
              "pa": (math.degrees(math.atan2(pmra, pmdec)) + 360) % 360})

# 4) Tarama özeti
F = J("genis.json"); say = {}
for f in F:
    for a in f.get("adaylar", []): say[a["sinif"]] = say.get(a["sinif"], 0) + 1
# Şablon aralığının alt ucunda (K0) ikisi birden takılan yıldızlar gerçek bir uyum sayılmaz (büyük olasılıkla K0'dan sıcak): istatistik dışı
for y in Y: y["uc"] = y["sx_tip"] <= 0.25 and (y["gaia_tip"] is None or y["gaia_tip"] <= 0.25)
iki = [s for s in Y if s["gaia_tip"] is not None and not s["uc"]]; uy = sum(1 for s in iki if abs(s["sx_tip"] - s["gaia_tip"]) <= 1)
sab = json.load(open(os.path.join(K, "tur_sablon.json")))
D = {
    "uretim": datetime.date.today().isoformat(),
    "ozet": {"bolge": len(F), "kaynak": sum(f.get("toplam") or 0 for f in F), "sahte": say.get("sahte", 0), "aday": sum(say.values()),
             "tur_n": len(Y), "uyum_yuzde": round(100 * uy / max(1, len(iki))), "uyum_n": len(iki), "uc_n": sum(1 for y in Y if y["uc"]), "hale_n": sum(1 for s in Y if s["hale"]),
             "sefeid_p": "30,5", "sefeid_bilinen": "30,48", "ref_n": sab["dogrulama"]["n"], "ref_rms": str(sab["dogrulama"].get("m_rms", sab["dogrulama"]["rms"])).replace(".", ",")},
    "dogrulama": [
        {"ne": "Akı ölçümü · ε Indi B", "sonuc": "27,1 mJy ölçülen · 27,7 mJy beklenen", "aciklama": "1,15–1,35 µm'de SPHEREx açıklık fotometrisi, katalogdaki J kadirinden beklenen akıya %2 yakın."},
        {"ne": "Hareket testi · LP 319-53", "sonuc": "1341 mas/yıl SPHEREx · 1366 Gaia", "aciklama": "CatWISE 2015 konumu ile 2025–26 SPHEREx yığınından ölçülen öz hareket, Gaia DR3 değerine %2 yakın."},
        {"ne": "Tür tayini · türü bilinen yıldızlar", "sonuc": f"±{sab['dogrulama']['rms']} alt tür ({sab['dogrulama']['n']} yıldız)".replace(".", ","), "aciklama": "Her referans yıldız şablondan çıkarılıp geri kalanlarla tahmin edildi (birini-dışarıda-bırak); M cücelerinde ±0,9."},
        {"ne": "Kahverengi cüce tanıma · L/T", "sonuc": f"L/T ayrımı {sab['dogrulama'].get('lt_sinif','—')} · ε Indi B → T1,5",
         "aciklama": "Türü bilinen M9–T7,5 cücelerden SPHEREx şablonları kuruldu; ε Indi B (T1+T6) şablona konmadan sınandı. L cücelerinde SPHEREx J ve K akısı 2MASS'a %10 içinde uyuyor."},
        {"ne": "Periyot · Sefeid HV 1002 (LMC)", "sonuc": "30,5 gün SPHEREx · 30,48 bilinen", "aciklama": "Periyot SPHEREx ışık eğrisinden kör aramayla bulundu; yanlış periyotla katlanınca genlik yarıya düşüyor."},
        {"ne": "Katalog hatası · Barnard yıldızı", "sonuc": "10,03 → 10,39″/yıl", "aciklama": "Görüntüde yıldız beklenen yerden kaymıştı; HYG'deki eski öz hareketi Gaia DR3 değeriyle düzelttik."},
    ],
    "sinirlar": [
        {"ne": "Yeni cisim yok", "aciklama": "Taramadaki parlak 'bilinmeyen' adayların hepsi artefakt, bindirme ya da sahte hareket çıktı. Araç sahte keşfi ayıklıyor ama bu taramada gerçek yeni cisim bulmadık."},
        {"ne": "Kayma ve parlaklık sınırı", "aciklama": "SPHEREx pikseli 6,2″: 4″'ten küçük kaymayı ayırt edemez (pratikte ≥ ~400 mas/yıl). W2 ≈ 14,5'ten sönük kaynaklar görünmez."},
        {"ne": "Tür tahmini yaklaşıktır", "aciklama": "Şablonlar K0–T7,5 cücelerinden. M cücelerinde ±0,9, kahverengi cücelerde ±2,6 alt tür. Dev yıldız, beyaz cüce ve metalce fakir hale yıldızlarında sonuç yaklaşıktır."},
        {"ne": "Parlak yıldızlarda doyma", "aciklama": "K ≲ 9 yıldızlar SPHEREx'i doyurur; akı yalnız alt sınır olur. Değişken örneklerimizi bu yüzden LMC'deki sönük Sefeidden seçtik."},
    ],
    "yildizlar": sorted(Y, key=lambda s: -(s["vtan"] or 0)),
}
# 5) Parlak "bilinmeyen" adayların SPHEREx hareket testi (tarayıcıda motionTest ile; sonuçlar hareket_test.json)
if os.path.exists(os.path.join(K, "hareket_test.json")):
    HT = J("hareket_test.json"); c = {}
    for t in HT: c[t["sonuc"]] = c.get(t["sonuc"], 0) + 1
    D["ozet"]["hareket"] = {"n": len(HT), **c}
    D["dogrulama"].append({"ne": f"{len(HT)} parlak 'bilinmeyen' aday", "sonuc": f"{c.get('dogrulandi', 0)} doğrulandı · {c.get('sahte', 0)} yerinde · {c.get('belirsiz', 0) + c.get('secilemedi', 0) + c.get('kisa', 0) + c.get('hata', 0)} belirsiz",
        "aciklama": "Gaia'da da SIMBAD'da da olmayan parlak adaylar SPHEREx 2025–26 görüntülerinde sınandı: 2015 konumunda mı duruyorlar, yoksa beklenen yere mi kaymışlar?"})
json.dump(D, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(Y)} yıldız, Gaia ile ±1 içinde %{D['ozet']['uyum_yuzde']}, hale adayı {D['ozet']['hale_n']}, kaynak {D['ozet']['kaynak']}, sahte {D['ozet']['sahte']}")
