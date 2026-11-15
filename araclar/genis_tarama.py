# Gökyüzüne düzgün dağılmış N bölgede /api/kesif sorgusu; tüm adayları tek dosyada toplar.
# Kullanım: SSL_CERT_FILE=/etc/ssl/cert.pem python3 -I genis_tarama.py cikti.json [N=100] [paralel=2]
import json, math, sys, time, urllib.request, concurrent.futures as cf

API = "https://sphere.arpama.tr"
out = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 100; PAR = int(sys.argv[3]) if len(sys.argv) > 3 else 2

def fibonacci(n):
    """Küre üzerinde düzgün dağılmış n nokta (Fibonacci kafesi), derece cinsinden RA/Dec."""
    g = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        yield round(math.degrees(g * i) % 360, 3), round(math.degrees(math.asin(z)), 3)

def get(path, tries=3):
    for k in range(tries):
        try:
            req = urllib.request.Request(API + path, headers={"User-Agent": "arpasphere-kesif/1.0 (curl-compatible)"})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.load(r)
        except Exception as e:
            err = e; time.sleep(5 * (k + 1))
    raise err

def field(p):
    ra, dec = p
    try:
        d = get(f"/api/kesif?ra={ra:.3f}&dec={dec:.3f}&r=1&pm=0.2")
        return {"ra": ra, "dec": dec, "n": d.get("n"), "toplam": d.get("toplam"), "hata": d.get("hata"), "adaylar": d.get("adaylar", [])}
    except Exception as e:
        return {"ra": ra, "dec": dec, "hatali": str(e)}

R = []
with cf.ThreadPoolExecutor(PAR) as ex:
    for i, f in enumerate(ex.map(field, fibonacci(N))):
        R.append(f)
        c = {}
        for a in f.get("adaylar", []): c[a["sinif"]] = c.get(a["sinif"], 0) + 1
        print(f'{i+1:3d}/{N} {f["ra"]:7.2f} {f["dec"]:+6.2f}  {f.get("hatali") or c}', flush=True)
        json.dump(R, open(out, "w"))
