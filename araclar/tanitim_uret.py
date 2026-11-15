# explain.arpama.tr tanıtım sayfasını üretir: tanitim/public/index.html
# "Ana kodlar" bölümündeki parçalar gerçek kaynak dosyalardan (worker/worker.js, worker/s3kesit.js, site/index.html) çekilir,
# böylece sayfa her zaman yayındaki kodla aynıdır. Kullanım: python3 araclar/tanitim_uret.py
import html, json, os, re

B = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # depo kökü
oku = lambda f: open(os.path.join(B, f), encoding="utf-8").read()
worker, s3, sayfa = oku("worker/worker.js"), oku("worker/s3kesit.js"), oku("site/index.html")


def parca(metin, bas, son="\n}\n"):
    i = metin.index(bas)
    j = metin.index(son, i) + len(son)
    return metin[i:j].rstrip()


KODLAR = [
    ("worker/worker.js", "SPHEREx görüntü listesi",
     "Her sorguda IRSA'nın SIA servisinden o noktayı kapsayan bütün SPHEREx görüntüleri alınır; haftalık yeni veriler kendiliğinden gelir. "
     "Yanıt ~330 KB'lık bir CSV. Eskiden karakter karakter ayrıştırılıyordu ve Cloudflare'in işlem süresi sınırını aşıyordu (hata 1102); "
     "şimdi satır satır bölünüyor: 25,7 ms → 2,4 ms, sonuç birebir aynı.",
     parca(worker, "async function search(u) {")),
    ("worker/s3kesit.js", "Dosyanın yalnız gereken baytları",
     "Bir SPHEREx görüntüsü ~70 MB. Worker, NASA'nın herkese açık S3 deposundan HTTP Range ile yalnız başlığı ve hedefin çevresindeki satırları okur; "
     "sıkıştırılmış bayrak katmanını (RICE) kendisi çözer. Olmazsa IRSA'nın kesit servisine döner.",
     s3.split("\n\n")[0].rstrip() + "\n\n" + parca(s3, "async function aralik(")),
    ("site/index.html", "Yıldız izleme (otomatik tarama)",
     "Her yıldızın her SPHEREx karesindeki ağırlık merkezi bulunur ve zamana göre ağırlıklı bir doğru uydurulur. "
     "Pencere yıldızın parlaklık yarıçapına göre büyür: doymuş parlak bir yıldızın çekirdeği düz olduğundan küçük pencere hareketi göremez.",
     parca(sayfa, "function yildizIzle(")),
    ("site/index.html", "Mollweide izdüşümü",
     "Girişteki tüm gökyüzü haritası Galaktik koordinatlarda 2:1 Mollweide. Seçilen yıldızın yeri aynı formülle altın halkayla işaretlenir; "
     "2θ + sin 2θ = π sin b denklemi Newton yöntemiyle çözülür.",
     parca(sayfa, "function mollXY(", "\nfunction ")),
]

BJ = json.load(open(os.path.join(B, "tanitim", "public", "barnard.json"), encoding="utf-8"))

kod_html = "\n".join(
    f'''      <article class="kod">
        <header><span class="dosya">{html.escape(d)}</span><h3>{html.escape(b)}</h3></header>
        <p>{html.escape(a)}</p>
        <pre><code>{html.escape(k)}</code></pre>
      </article>''' for d, b, a, k in KODLAR)

kare_img = "\n".join(
    f'<img src="{k["dosya"]}" alt="" data-i="{i}"{" class=on" if i == 0 else ""} width="512" height="512" decoding="async">'
    for i, k in enumerate(BJ["kareler"]))

SAYFA = open(os.path.join(B, "araclar", "tanitim_sablon.html"), encoding="utf-8").read()
SAYFA = SAYFA.replace("{{KODLAR}}", kod_html).replace("{{KARELER}}", kare_img).replace("{{BARNARD}}", json.dumps(BJ, ensure_ascii=False))
open(os.path.join(B, "tanitim", "public", "index.html"), "w", encoding="utf-8").write(SAYFA)
print("yazıldı:", os.path.join(B, "tanitim", "public", "index.html"), len(SAYFA), "bayt")
