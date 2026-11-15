# blink.html için İngilizce sözlük üretir: sayfadaki sabit Türkçe metinleri (başlarına göre eşleyerek tam hâlleriyle) İngilizceye bağlar.
# Çıktı: ceviri_en.js (window.I18N_EN = {tam Türkçe metin: İngilizce}). Kullanım: python3 araclar/ceviri_en.py
import re, html, json, os

KOK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site")
s = open(os.path.join(KOK, "index.html"), encoding="utf-8").read()
body = s[s.index("<body>"):s.index('<script src="targets.js">')]
metin = [html.unescape(m.group(1)).strip() for m in re.finditer(r">([^<>]+)<", body)]
metin += [html.unescape(a) for a in re.findall(r'(?:placeholder|title|aria-label)="([^"]+)"', body)]
metin = [t for t in dict.fromkeys(metin) if t]

# Türkçe metnin başı → İngilizce (başı eşleşen tam metin çevrilir)
EN = {
 "Karşılaştırıcı": "Comparator", "SPHEREx · 0,75–5 µm · 102 bant": "SPHEREx · 0.75–5 µm · 102 bands", "Bulgularımız": "Our findings",
 "Hazır": "Ready", "Bağlantıyı kopyala": "Copy link", "Hareket eden ve değişen gökyüzünü": "Find the moving and changing sky in",
 "102 renkte": "102 colours.", "bul.": "", "1 dakikalık tur": "1-minute tour",
 "Farklı yıllarda çekilmiş taramaları": "Overlays sky surveys taken in different years at the same coordinates. Fixed stars stay put, a moving object jumps. Click the image: SPHEREx measures that point's spectrum.",
 "Örnek hedefler": "Sample targets", "tek tıkla hedef": "one click sets the target, surveys and detectors",
 "Hedef": "Target", "Cisim adı": "Object name", "Ara": "Find", "RA (° veya ss dd ss)": "RA (° or hh mm ss)", "Dec (° veya": "Dec (° or ° ′ ″)",
 "Görüntüleri yükle": "Load images", "Görüntü": "Image", "Fark": "Difference", "Toplam": "Stack", "Parlaklığı eşitle": "Normalise brightness",
 "Önceki kareye göre fark al": "Difference against previous frame", "Zamana göre renklendir": "Colour by time", "Merkez işareti": "Centre mark",
 "Beklenen yolu çiz": "Draw expected path", "Görüş alanı · yay dakikası": "Field of view · arcminutes", "SPHEREx görüntülerini kullan": "Use SPHEREx images",
 "Görünüm": "View", "Bant (102 kanal": "Band (102 channels: 6 detectors × 17)", "Bayrak maskesi": "Flag mask",
 "Kare başına en az görüntü": "Minimum images per frame", "Hepsi (sığ kareler dahil)": "All (including shallow frames)", "8 · sönük hedefler için": "8 · for faint targets",
 "Maskelenen pikselleri kırmızı göster": "Show masked pixels in red",
 "Görüntü listesi her sorguda IRSA": "The image list comes from the IRSA archive on every query; weekly new data arrives automatically. Images from the same epoch are stacked, bad pixels (flag layer) are masked.",
 "Öz hareket katmanları": "Proper-motion layers", "Gaia DR3 · öz hareket okları": "Gaia DR3 · proper-motion arrows", "CatWISE2020 · kızılötesi (W1/W2)": "CatWISE2020 · infrared (W1/W2)",
 "Daire/kare: kaynağın": "Circle/square: the source's expected position at that frame's date, moving along during the blink. Arrow: its path over the years shown. Hover for details; click for its spectrum (tracking its motion).",
 "Alandaki hızlı yıldızlar (Gaia)": "Fast stars in the field (Gaia)", "Referans taramalar": "Reference surveys", "1953 → bugün": "1953 → today",
 "Kapsama dışındaki taramalar": "Surveys without coverage are skipped automatically. Dates are approximate epochs.",
 "Yıldız kataloğu": "Star catalogue", "Katalogda ara": "Search catalogue", "ad, Gl, HD, HIP": "name, Gl, HD, HIP… (e.g. 61 Cyg, Wolf)",
 "Tümü": "All", "Hızlı": "Fast", "Yakın": "Near", "Adlı": "Named", "Değişen": "Variable", "Sırala": "Sort",
 "Öz hareket (büyükten)": "Proper motion (largest)", "Uzaklık (yakından)": "Distance (nearest)", "Parlaklık (parlaktan)": "Brightness (brightest)",
 "Değişim genliği": "Variability amplitude", "Ad": "Name", "Katalog yükleniyor…": "Loading catalogue…", "Deneme alanı": "Practice field", "çevrimdışı": "offline",
 "Rastgele bir yıldız alanı üretilir": "A random star field is generated with hidden fast and slow movers, a variable star, a new source and a one-frame asteroid. Try to find them yourself first.",
 "Rastgele veriyle dene": "Try with random data", "Yeni alan": "New field", "Gizli cisimleri göster": "Reveal hidden objects",
 "Bir hedef seç": "Pick a target", "Yukarıdaki örneklerden birine": "Click one of the samples above, or enter a name or coordinates and load the images.",
 "Yükleniyor…": "Loading…", "Hız": "Speed", "Boşluk": "Space",
 "Keşif · bilinmeyeni bul": "Discovery · find the unknown",
 "Görünümün çevresinde CatWISE": "Compares sources that CatWISE says move fast around the view with Gaia DR3 and SIMBAD, then tests the rest with SPHEREx: have they really moved since 2015?",
 "0,25° yarıçap": "0.25° radius", "0,5° yarıçap": "0.5° radius", "1° yarıçap": "1° radius", "≥ 0,2″/yıl": "≥ 0.2″/yr", "≥ 0,3″/yıl": "≥ 0.3″/yr",
 "≥ 0,5″/yıl": "≥ 0.5″/yr", "≥ 1″/yıl": "≥ 1″/yr", "Bu bölgeyi tara": "Scan this region", "Listeyi sırayla test et": "Test the list in turn", "hepsi": "all",
 "Spektrum ve ışık eğrisi": "Spectrum and light curve", "102 bant": "102 bands", "Hedefin spektrumunu çıkar": "Measure target spectrum",
 "Dalga boyu": "Wavelength", "Zaman": "Time", "Faz": "Phase", "Dedektör": "Detector", "Tüm dedektörler": "All detectors",
 "Bir noktanın spektrumu için": "Click the image for a point's spectrum, or measure the target's. Aperture photometry (r = 2 px, annulus background) is done on every archive image; a selected target's motion is tracked.",
 "Kare bilgisi": "Frame info", "Aladin Lite · gökyüzü atlası": "Aladin Lite · sky atlas", "Açınca yüklenir": "Loads when opened (~2 MB). Tiles come from IRSA's HiPS mirror.",
 "Görüntüler: NASA SPHEREx": "Images: NASA SPHEREx (IRSA), STScI DSS and Pan-STARRS, legacysurvey.org, NASA SkyView · Catalogues: Gaia DR3, CatWISE2020 (IRSA) ·",
 "(CC BY-SA 4.0) · İsim çözümleme": "(CC BY-SA 4.0) · Name resolution: CDS Sesame / SIMBAD", "Kısayollar:": "Shortcuts:", "oynat/durdur": "play/pause",
 "kare": "frame", "mod": "mode", "Bu görünümün bağlantısı:": "Link to this view:", "Demoya hazırla": "Prepare for demo",
 "Sunumdan önce, demo yapılacak": "Run once on the demo computer before presenting: preloads sample targets, spectra and discovery lists (~5–10 min).",
 "Bu görünümün bağlantısını kopyala": "Copy a link to this view", "Önceki kare (←)": "Previous frame (←)", "Sonraki kare (→)": "Next frame (→)",
 "Oynat / durdur (boşluk)": "Play / pause (space)", "Önceki kare": "Previous frame", "Sonraki kare": "Next frame", "Oynat": "Play", "Durdur": "Pause",
 "Kontroller": "Controls", "Gözlem": "Observation", "Gökyüzü görüntüsü": "Sky image", "Arama yarıçapı": "Search radius", "En küçük öz hareket": "Minimum proper motion",
 "Yatay eksen": "Horizontal axis", "Tarama": "Survey", "ArpaSphere, ana sayfa": "ArpaSphere, home",
 "Rehberli tur": "Guided tour", "Örnek hedefler ": "Sample targets",
}
out, eksik = {}, []
for t in metin:
    if t in EN: out[t] = EN[t]; continue
    hit = [k for k in EN if len(k) > 6 and t.startswith(k)]
    if hit: out[t] = EN[max(hit, key=len)]
    elif re.search(r"[çğıöşüÇĞİÖŞÜ]|\b(ve|veya|bir|için)\b", t): eksik.append(t)
# Kod içinde üretilen sabit metinler (kartlar, sınıflar, sonuçlar, düğmeler)
out.update({
 "Bilinmeyen": "Unknown", "Türü yok": "No type", "Adsız": "Unnamed", "Bilinen": "Known", "Sahte": "Spurious",
 "Gaia'da da SIMBAD'da da yok": "In neither Gaia nor SIMBAD", "Gaia'da var, SIMBAD'da kaydı yok": "In Gaia, not in SIMBAD",
 "Hareket doğrulandı": "Motion confirmed", "Yerinde duruyor (sahte)": "Stays in place (spurious)", "Belirsiz": "Inconclusive",
 "SPHEREx'te seçilemedi": "Not detected by SPHEREx", "Kayma SPHEREx için çok küçük": "Shift too small for SPHEREx", "Test yapılamadı": "Test failed",
 "SPHEREx testi": "SPHEREx test", "Spektrum + tür": "Spectrum + type", "Görüntüde aç": "Open in viewer", "Durdur": "Stop",
 "Kapat": "Close", "Geri": "Back", "İleri": "Next", "Bitir": "Finish", "Sonra": "Later", "Turu başlat": "Start tour",
 "İlk kez mi geldin?": "First time here?", "1 dakikalık tur sitenin ne yaptığını adım adım gösterir.": "A 1-minute tour shows what the site does, step by step.",
 "sönük": "faint", "veri yok": "no data", "Hazır: her şey önbellekte.": "Ready: everything is cached.",
 "Çok hızlı yüklenir, ayrıntılı.": "Loads very fast, detailed.", "Dengeli; yakın, hızlı yıldızlar için ideal.": "Balanced; ideal for nearby fast stars.",
 "Orta alan.": "Medium field.", "1°: hızlı hareket edenler alandan çıkmaz ama ayrıntı azalır.": "1°: fast movers stay in the field but detail drops.", "Geniş alan, yavaş yükler.": "Wide field, loads slowly.",
 "Önerilen": "Recommended", "Sıkı": "Strict", "Kapalı": "Off",
 "Ölü, sıcak, soğuk, kalıcı iz (persistence), aykırı (kozmik ışın) ve eksik pikseller atılır.": "Dead, hot, cold, persistence, outlier (cosmic ray) and missing pixels are rejected.",
 "Önerilenlere ek olarak geçici, doğrusal olmayan, hayalet, çapraz konuşma, taşma (bloom), kartopu ve hale pikselleri de atılır. Parlak yıldız çekirdekleri boşalabilir.": "In addition: transient, non-linear, ghost, crosstalk, bloom, snowball and halo pixels are rejected. Bright star cores may empty out.",
 "Hiçbir bayrak kullanılmaz; yalnız değeri olmayan pikseller atlanır. Karşılaştırma için.": "No flags used; only pixels without a value are skipped. For comparison.",
 "Geniş bant (dönem başına tek kare)": "Broadband (one frame per epoch)", "Dedektör başına ayrı kare": "Separate frame per detector", "Sahte renk (R: D5–6, G: D3–4, B: D1–2)": "False colour (R: D5–6, G: D3–4, B: D1–2)",
 "Tümü (seçili dedektörler)": "All (selected detectors)",
 "POSS-I Kırmızı": "POSS-I Red", "POSS-I Mavi": "POSS-I Blue", "DSS2 Mavi": "DSS2 Blue", "DSS2 Kırmızı": "DSS2 Red", "~1999 · yalnız blink": "~1999 · blink only",
})
# Katalog notları (targets.json, 13. alan): başına göre eşlenir
NOT_EN = {
 "Bilinen en yakın tekil beyaz cücelerden": "One of the nearest single white dwarfs; high proper motion.",
 "Ünlü uzun dönemli değişen yıldız": "Famous long-period variable; brightness changes by several magnitudes over ~11 months.",
 "Kutup Yıldızı": "The Pole Star; a low-amplitude Cepheid variable.",
 "Örten çift yıldız": "Eclipsing binary; dims markedly every ~2.9 days.",
 "Öz hareketi Barnard'dan sonra": "One of the stars with the largest proper motion after Barnard's; an old star passing through the Galactic halo.",
 "Kırmızı süperdev": "Red supergiant, semi-regular variable.",
 "Gece gökyüzünün en parlak yıldızı": "The brightest star in the night sky; has a white-dwarf companion, Sirius B. Saturates in images because of its brightness.",
 "Yakın bir kırmızı cüce; çevresinde": "A nearby red dwarf with a known planet.",
 "Kuzey gökyüzünün en yakın kırmızı cücelerinden": "One of the nearest red dwarfs in the northern sky.",
 "Çok hızlı hareket eden, metal fakiri": "A very fast-moving, metal-poor halo star.",
 "Yüksek öz hareketli parlak dev yıldız": "A bright giant with high proper motion (~2.3″/yr).",
 "Güneş'e en yakın yıldız": "The nearest star to the Sun (~1.3 pc); third member of the Alpha Centauri system.",
 "Alfa Centauri B": "Alpha Centauri B, orbiting A.",
 "Alfa Centauri A": "Alpha Centauri A; the nearest star system visible to the naked eye.",
 "Gökyüzünde en hızlı öz harekete": "The star with the fastest proper motion in the sky (~10.3″/yr). The classic blink target.",
 "Yakın ve hızlı hareket eden kırmızı cüce": "A nearby, fast-moving red dwarf.",
 "Çift kahverengi cüce (T1+T6)": "Binary brown dwarf (T1+T6), 1460 AU from ε Indi A. Very faint optically, bright in the infrared; ~4.7″/yr proper motion.",
 "Bilinen en soğuk kahverengi cüce": "The coldest known brown dwarf (~285 K). Invisible in optical surveys; appears only at 3–5 µm (SPHEREx D5–D6). ~8.1″/yr to the west.",
}
for st in json.load(open(os.path.join(KOK, "targets.json"), encoding="utf-8"))["stars"]:
    n = st[12] if len(st) > 12 else ""
    if n:
        hit = [k for k in NOT_EN if n.startswith(k)]
        if hit: out[n] = NOT_EN[max(hit, key=len)]
        else: print("  not çevrilmedi:", n[:70])
open(os.path.join(KOK, "ceviri_en.js"), "w", encoding="utf-8").write("window.I18N_EN=" + json.dumps(out, ensure_ascii=False) + ";\n")
print(len(out), "çeviri;", len(eksik), "eksik:"); [print("  ", repr(t[:90])) for t in eksik]
