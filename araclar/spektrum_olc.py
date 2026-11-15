# Yıldız listesi için SPHEREx spektrumu: sphere.arpama.tr Worker'ının /api/spherex/ara ve /foto uçlarıyla.
# Kullanım: python3 spektrum.py yildizlar.json cikti_klasoru [en_fazla_goruntu]
# yildizlar.json: [{"ad":..., "ra":..., "dec":..., "ep":2000.0, "pmra":mas/yıl, "pmdec":mas/yıl, ...}, ...]
import json, math, os, sys, time, urllib.request, urllib.parse, concurrent.futures as cf

API = "https://sphere.arpama.tr"

def get(path, tries=3):
    for k in range(tries):
        try:
            req = urllib.request.Request(API + path, headers={"User-Agent": "arpasphere-kesif/1.0 (curl-compatible)"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:
            err = e; time.sleep(1.5 * (k + 1))
    raise err

def at(s, yr):
    t = yr - s["ep"]; cd = math.cos(math.radians(s["dec"]))
    return s["ra"] + s["pmra"] / 3.6e6 * t / cd, s["dec"] + s["pmdec"] / 3.6e6 * t

def mjd2yr(m): return 2000 + (m - 51544.5) / 365.25

def spectrum(s, nmax):
    ra, dec = at(s, 2026.0)
    L = get(f"/api/spherex/ara?ra={ra:.5f}&dec={dec:.5f}")["goruntuler"]
    # dalga boyuna göre sırala ve eşit aralıklı seç: tüm 102 kanalı kapsasın
    L.sort(key=lambda x: (x["wmin"] + x["wmax"]) / 2)
    if len(L) > nmax: L = [L[int(i * len(L) / nmax)] for i in range(nmax)]
    def one(im):
        r, d = at(s, mjd2yr(im["mjd"]))
        try:
            return get("/api/spherex/foto?" + urllib.parse.urlencode({"url": im["url"], "ra": f"{r:.6f}", "dec": f"{d:.6f}"}))
        except Exception as e:
            return {"hata": str(e)}
    with cf.ThreadPoolExecutor(6) as ex:
        P = list(ex.map(one, L))
    return [p for p in P if "hata" not in p]

stars = json.load(open(sys.argv[1])); out = sys.argv[2]; nmax = int(sys.argv[3]) if len(sys.argv) > 3 else 100
os.makedirs(out, exist_ok=True)
for s in stars:
    fn = os.path.join(out, s["ad"].replace(" ", "_").replace("/", "_") + ".json")
    if os.path.exists(fn): continue
    t0 = time.time()
    try:
        P = spectrum(s, nmax)
    except Exception as e:
        print(s["ad"], "HATA", e, flush=True); continue
    json.dump({**s, "olcum": P}, open(fn, "w"))
    ok = sum(1 for p in P if p.get("ok") and not p.get("sat"))
    print(f'{s["ad"]:28s} {s.get("sp",""):8s} {len(P):3d} ölçüm, {ok:3d} temiz, {time.time()-t0:.0f} sn', flush=True)
