// Canlı: SPHEREx arşivinin (IRSA, herkese açık S3 deposu nasa-irsa-spherex) güncel durumu.
// IRSA her hafta yeni planlama periyotlarını (ör. 2026W40_2A: 2026'nın 40. haftası, 2A dilimi) yükler.
// S3 listesi TAP'tan çok daha hızlı (TAP'ta "en yeni" sorgusu 2 dakikayı aşıyor), bu yüzden doğrudan klasörler taranır.
const S3 = "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/";
const IBE = "https://irsa.ipac.caltech.edu/ibe/data/spherex/";
const KOLEKSIYON = [["qr3", "QR3"], ["dr1", "DR1"], ["qr2", "QR2"]];
const SON_N = 6;          // ayrıntısı gösterilen son periyot sayısı
const YENI_HESAP = 2;     // bir istekte en çok kaç periyot baştan sayılır (Worker alt istek sınırı)

const xmlAl = (t, ad) => [...t.matchAll(new RegExp(`<${ad}>(.*?)</${ad}>`, "g"))].map(m => m[1]);

async function s3Klasorler(prefix) {
  const r = await fetch(`${S3}?list-type=2&delimiter=/&prefix=${encodeURIComponent(prefix)}`);
  if (!r.ok) throw new Error("S3 liste " + r.status);
  return xmlAl(await r.text(), "Prefix").filter(p => p !== prefix);
}

// Bir periyodun bütün dosyaları (sayfa sayfa, 1000'er)
async function periyotSay(prefix) {
  let tok = null, dosya = 0, boyut = 0, ilk = null, son = null, enYeni = null, retry = 0;
  const poz = new Map(), surum = new Set();
  do {
    const r = await fetch(`${S3}?list-type=2&prefix=${encodeURIComponent(prefix)}${tok ? "&continuation-token=" + encodeURIComponent(tok) : ""}`);
    if (!r.ok) throw new Error("S3 liste " + r.status);
    const t = await r.text();
    for (const m of t.matchAll(/<Key>(.*?)<\/Key><LastModified>(.*?)<\/LastModified>.*?<Size>(\d+)<\/Size>/g)) {
      const [, k, lm, sz] = m; dosya++; boyut += +sz;
      if (!ilk || lm < ilk) ilk = lm;
      if (!son || lm > son) { son = lm; enYeni = { anahtar: k, zaman: lm, boyut: +sz }; }
      const s = k.split("/")[3]; if (s) surum.add(s); if (/retry/.test(s)) retry++;
      const o = k.match(/level2_(\w+?_\d{4}_\d)D(\d)/);
      if (o && (!poz.has(o[1]) || o[2] === "1")) poz.set(o[1], k);
    }
    tok = (t.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/) || [])[1];
  } while (tok);
  const ids = [...poz.keys()].sort();
  return { dosya, boyut, pozlama: ids.length, ilkYukleme: ilk, sonYukleme: son, enYeniDosya: enYeni,
    ilkPoz: ids.length ? { id: ids[0], anahtar: poz.get(ids[0]) } : null,
    sonPoz: ids.length ? { id: ids.at(-1), anahtar: poz.get(ids.at(-1)) } : null,
    surum: [...surum].sort(), retry };
}

// FITS başlığı (görüntü katmanı): yalnız ilk 32 KB okunur
async function baslik(anahtar) {
  const r = await fetch(S3 + anahtar, { headers: { Range: "bytes=0-32767" } });
  if (!r.ok && r.status !== 206) throw new Error("S3 başlık " + r.status);
  const b = new TextDecoder("latin1").decode(await r.arrayBuffer()), o = {};
  let hdu = 0;
  for (let i = 0; i + 80 <= b.length; i += 80) {
    const c = b.slice(i, i + 80);
    if (c.startsWith("END ")) { if (++hdu === 2) break; i = Math.ceil((i + 80) / 2880) * 2880 - 80; continue; }
    const m = c.match(/^(?:HIERARCH )?([A-Z0-9_-]+)\s*=\s*('(?:[^']|'')*'|[^/]*)/);
    if (!m) continue;
    let v = m[2].trim(); if (v.startsWith("'")) v = v.slice(1, -1).trim(); else if (v !== "" && isFinite(+v)) v = +v;
    o[m[1]] = v;
  }
  const al = ["OBSID", "DATE-OBS", "DATE-END", "MJD-OBS", "XPOSURE", "CRVAL1", "CRVAL2", "DETECTOR", "SPS_TARGET", "SPS_FLAGS", "NON_SURVEY", "PSF_FWHM", "VERSION"];
  return Object.fromEntries(al.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
}

async function onbellekJSON(anahtar, ttl, yap) {
  const c = caches.default, k = new Request(anahtar);
  const hit = await c.match(k); if (hit) return { v: await hit.json(), yeni: false };
  const v = await yap();
  await c.put(k, new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` } }));
  return { v, yeni: true };
}
async function onbellekVarMi(anahtar) { return !!(await caches.default.match(new Request(anahtar))); }

export async function canli(origin) {
  const kok = `${origin}/api/canli/_`;
  const listeler = await Promise.all(KOLEKSIYON.map(([k]) => s3Klasorler(`${k}/level2/`)));
  const per = new Map();
  KOLEKSIYON.forEach(([k, ad], i) => listeler[i].forEach(p => {
    const n = p.split("/")[2]; if (!/^\d{4}W\d{2}_\w+$/.test(n)) return;
    if (!per.has(n)) per.set(n, { ad: n, yayin: [] }); per.get(n).yayin.push(ad);
  }));
  const tum = [...per.values()].sort((a, b) => a.ad < b.ad ? -1 : 1);
  // Ayrıntı: en yeni periyotlar (hangi yayında en yeniyse oradan) + DR1'in en yenisi
  const hedef = [];
  for (const p of tum.slice(-SON_N).reverse()) { const k = KOLEKSIYON.find(([, a]) => a === p.yayin[0])[0]; hedef.push({ ad: p.ad, kol: k }); }
  const dr1Son = listeler[1].at(-1)?.split("/")[2];
  if (dr1Son && !hedef.some(h => h.ad === dr1Son && h.kol === "dr1")) hedef.push({ ad: dr1Son, kol: "dr1" });
  let hesap = 0, eksik = false;
  const ozet = [];
  for (const h of hedef) {
    const anahtar = `${kok}/p/${h.kol}/${h.ad}?v=1`, enYeni = h === hedef[0];
    if (!(await onbellekVarMi(anahtar))) { if (hesap >= YENI_HESAP) { eksik = true; ozet.push({ ...h, hazir: false }); continue; } hesap++; }
    try { const { v } = await onbellekJSON(anahtar, enYeni ? 3 * 3600 : 30 * 86400, () => periyotSay(`${h.kol}/level2/${h.ad}/`)); ozet.push({ ...h, hazir: true, ...v }); }
    catch (e) { eksik = true; ozet.push({ ...h, hazir: false, hata: String(e.message || e) }); }
  }
  // En yeni pozlama ve periyodun ilk pozlaması: başlıktan gözlem zamanı ve gökyüzü konumu
  const ilk = ozet[0];
  let sonPoz = null, ilkPoz = null;
  if (ilk && ilk.hazir && ilk.sonPoz) {
    const [a, b] = await Promise.all([baslik(ilk.sonPoz.anahtar).catch(() => null), baslik(ilk.ilkPoz.anahtar).catch(() => null)]);
    if (a) sonPoz = { ...a, anahtar: ilk.sonPoz.anahtar, url: IBE + ilk.sonPoz.anahtar, kol: ilk.kol };
    if (b) ilkPoz = { ...b, anahtar: ilk.ilkPoz.anahtar };
  }
  const dosyalar = ozet.filter(o => o.hazir && o.enYeniDosya).map(o => ({ ...o.enYeniDosya, periyot: o.ad, kol: o.kol }));
  const enYeniDosya = dosyalar.sort((a, b) => a.zaman < b.zaman ? 1 : -1)[0] || null;
  if (enYeniDosya) enYeniDosya.url = IBE + enYeniDosya.anahtar;
  const sayac = Object.fromEntries(KOLEKSIYON.map(([k, ad], i) => [ad, listeler[i].filter(p => /\d{4}W\d{2}_/.test(p)).length]));
  return { kontrol: new Date().toISOString(), eksik, sayac, toplamPeriyot: tum.length, periyotlar: tum, son: ozet, sonPoz, ilkPoz, enYeniDosya };
}
