// ArpaSphere – Cloudflare Worker
// Statik dosyaları sunar; IRSA (SPHEREx) için CORS'lu küçük bir ara katman sağlar.
//   /api/spherex/ara?ra=..&dec=..           → o noktayı kapsayan tüm SPHEREx görüntüleri (JSON)
//   /api/spherex/kesit?url=..&ra=..&dec=..&size=..  → FITS kesit (yalnız IMAGE, FLAGS, VARIANCE, ZODI)
//   /api/spherex/dalga?url=..&ra=..&dec=..   → dedektörün dalga boyu tablosu (WCS-WAVE) JSON
//   /api/spherex/foto?url=..&ra=..&dec=..    → tek görüntüde o noktanın açıklık fotometrisi (µJy) + hedefteki λ
//   /api/katalog?k=gaia|catwise&ra=..&dec=..&r=..  → Gaia DR3 / CatWISE2020 kaynakları ve öz hareketleri (IRSA TAP)
//   /api/kesif?ra=..&dec=..&r=..&pm=..        → keşif adayları: CatWISE'ta hızlı (≥5σ), Gaia DR3 ve SIMBAD eşleşmesiyle sınıflanmış
//   /api/neossat/ara?ra=..&dec=..           → o noktayı kapsayan NEOSSat (Kanada Uzay Ajansı) gözlemleri, CADC TAP
//   /api/neossat/dosya?id=..               → tek NEOSSat FITS dosyası (CADC'de CORS yok)
//   /api/cadc/ara?ra=..&dec=..             → CADC'de o noktayı kapsayan açık görüntüler (CFHT, HST, JWST, Gemini, Subaru…)
//   /api/cadc/kesit?uri=..&ra=..&dec=..&r=.. → CADC SODA kesiti (FITS, hedef merkezli)
//   /api/skybot?ra=..&dec=..&r=..&t=ISO    → o anda o bölgedeki bilinen asteroit ve kuyruklu yıldızlar (IMCCE SkyBoT)
//   POST /api/ses {metin, dil}               → ElevenLabs ile seslendirme (mp3); anahtar Cloudflare gizli değişkeninde (ELEVENLABS_API_KEY)
//   /api/hips/<yol>                        → IRSA'nın HiPS aynası (Aladin Lite karoları; CDS kullanıcının ağından erişilemiyor)

import { kesitS3, dalgaS3 } from "./s3kesit.js";
import { canli } from "./canli.js";
const IRSA = "https://irsa.ipac.caltech.edu";
// S3 denemesi için üst süre; aşılırsa ya da hata olursa IRSA'nın kesit servisine dönülür
const zamanli = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("zaman aşımı")), ms))]);
const IBE_PREFIX = IRSA + "/ibe/data/spherex/";
const CORS = { "Access-Control-Allow-Origin": "*" };

export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    try {
      if (u.pathname === "/api/cadc/ara") return await cached(req, ctx, 86400, () => cadcAra(u));
      if (u.pathname === "/api/cadc/kesit") return await cached(req, ctx, 86400 * 30, () => cadcKesit(u));
      if (u.pathname === "/api/neossat/ara") return await cached(req, ctx, 86400, () => neossatAra(u));
      if (u.pathname === "/api/neossat/dosya") return await cached(req, ctx, 86400 * 30, () => neossatDosya(u));
      if (u.pathname === "/api/coz") return await cached(req, ctx, 86400 * 30, () => coz(u));
      if (u.pathname === "/api/skybot") return await cached(req, ctx, 86400 * 30, () => skybot(u));
      if (u.pathname === "/api/ses") return await ses(req, env, ctx);
      if (u.pathname === "/api/canli") { // SPHEREx arşivinin güncel durumu; eksikse (periyotlar sayılıyor) kısa süre önbellekte tutulur
        const k = new Request(`${u.origin}/api/canli?v=1`), hit = await caches.default.match(k);
        if (hit) return hit;
        const v = await canli(u.origin), r = json(v);
        r.headers.set("Cache-Control", `public, max-age=${v.eksik ? 8 : 1800}`);
        ctx.waitUntil(caches.default.put(k, r.clone()));
        return r;
      }
      if (u.pathname === "/api/spherex/ara") return await cached(req, ctx, 3600, () => search(u));
      if (u.pathname === "/api/spherex/kesit") return await cached(req, ctx, 86400 * 30, () => cutout(u));
      if (u.pathname === "/api/katalog") return await cached(req, ctx, 86400 * 30, () => catalog(u));
      if (u.pathname === "/api/kesif") return await cached(req, ctx, 86400 * 7, () => discover(u));
      if (u.pathname.startsWith("/api/hips/")) return await cached(`${u.origin}${u.pathname.replace(/^\/api\/hips\/v\d+\//, "/api/hips/")}?v=2`, ctx, 86400 * 30, () => hips(u)); // v: properties süzgeci değişirse artır
      if (u.pathname === "/api/spherex/foto") return await cached(req, ctx, 86400 * 30, () => photometry(u, ctx));
      if (u.pathname === "/api/spherex/dalga") return await cached(waveKey(u), ctx, 86400 * 30, () => waveTable(u));
    } catch (e) {
      return json({ hata: String(e && e.message || e) }, 502);
    }
    return env.ASSETS.fetch(req);
  },
};

// Aynı istek tekrar gelirse Cloudflare önbelleğinden ver
async function cached(req, ctx, ttl, make) {
  const cache = caches.default, key = new Request(typeof req === "string" ? req : req.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await make();
  if (res.ok) {
    const r = new Response(res.body, res);
    r.headers.set("Cache-Control", `public, max-age=${ttl}`);
    ctx.waitUntil(cache.put(key, r.clone()));
    return r;
  }
  return res;
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...CORS } });
const num = (v, lo, hi) => { const x = parseFloat(v); if (!isFinite(x) || x < lo || x > hi) throw new Error("geçersiz sayı"); return x; };

// ---------- Arama: IRSA SIA v2, tüm SPHEREx koleksiyonları (yeni yayınlar kendiliğinden gelir) ----------
async function search(u) {
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90);
  const q = new URLSearchParams({ FACILITY: "SPHEREx", POS: `circle ${ra} ${dec} 0.002`, RESPONSEFORMAT: "CSV" });
  const r = await fetch(`${IRSA}/SIA?${q}`);
  if (!r.ok) throw new Error("IRSA SIA " + r.status);
  // Hızlı ayrıştırma: gereken sütunların hepsi, tırnaklı JSON içeren cloud_access sütunundan önce ve virgülsüz.
  // (Karakter karakter ayrıştırma ~330 KB'lık yanıtta Worker'ın CPU sınırını aşıp 1102 hatası veriyordu.)
  const rows = (await r.text()).split("\n").filter(l => l.length > 1).map(l => l.split(","));
  const h = rows.shift() || [], c = k => h.indexOf(k);
  const out = rows.filter(r => r[c("dataproduct_subtype")] === "science" && /\/level2\//.test(r[c("access_url")] || "")).map(r => ({
    url: r[c("access_url")],
    det: +r[c("energy_bandpassname")].replace(/\D/g, ""),
    wmin: +(+r[c("em_min")] * 1e6).toFixed(3), wmax: +(+r[c("em_max")] * 1e6).toFixed(3),
    mjd: (+r[c("t_min")] + +r[c("t_max")]) / 2,
    obs: r[c("obs_id")], coll: r[c("obs_collection")],
    ...detPos(r[c("s_region")], ra, dec),
  })).sort((a, b) => a.mjd - b.mjd);
  return json({ ra, dec, n: out.length, guncel: new Date().toISOString(), goruntuler: out });
}

function parseCSV(t) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// ---------- Kesit: IRSA'nın kesitini al, ilk 5 HDU'dan sonrasını (büyük PSF tablosu) indirmeden kes ----------
async function cutout(u) {
  const url = u.searchParams.get("url") || ""; checkURL(url);
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90);
  const size = Math.round(num(u.searchParams.get("size") || 100, 8, 600));
  // Önce herkese açık S3 deposundan yalnız gereken satırlar (hızlı); olmazsa IRSA'nın kesit servisi
  try {
    const bytes = await zamanli(kesitS3(url, ra, dec, size), 12000);
    return new Response(bytes, { headers: { "Content-Type": "application/fits", "X-Kaynak": "s3", ...CORS } });
  } catch (e) {}
  const r = await fetch(`${url}?center=${ra},${dec}&size=${size}pix`);
  if (!r.ok) throw new Error("IRSA kesit " + r.status);
  const bytes = await readHDUs(r.body, 5);
  return new Response(bytes, { headers: { "Content-Type": "application/fits", "X-Kaynak": "irsa", ...CORS } });
}

// Akıştan yalnızca ilk `want` HDU'yu oku, sonra bağlantıyı kapat
async function readHDUs(stream, want) {
  const reader = stream.getReader();
  let buf = new Uint8Array(0), off = 0, hdus = 0;
  const need = async n => {
    while (buf.length < n) {
      const { value, done } = await reader.read();
      if (done) return false;
      const b = new Uint8Array(buf.length + value.length); b.set(buf); b.set(value, buf.length); buf = b;
    }
    return true;
  };
  while (hdus < want) {
    const cards = {};
    let end = false;
    while (!end) {
      if (!(await need(off + 2880))) { end = true; hdus = want; break; }
      const blk = new TextDecoder("latin1").decode(buf.subarray(off, off + 2880)); off += 2880;
      for (let i = 0; i < 2880; i += 80) {
        const card = blk.slice(i, i + 80), k = card.slice(0, 8).trim();
        if (k === "END") { end = true; break; }
        if (card[8] === "=") cards[k] = card.slice(10).split("/")[0].trim();
      }
    }
    if (hdus >= want) break;
    const naxis = +(cards.NAXIS || 0);
    let size = 0;
    if (naxis > 0) { size = Math.abs(+cards.BITPIX) / 8; for (let i = 1; i <= naxis; i++) size *= +cards["NAXIS" + i]; }
    size += +(cards.PCOUNT || 0);
    off += Math.ceil(size / 2880) * 2880;
    hdus++;
    if (!(await need(off))) break;
  }
  reader.cancel().catch(() => {});
  return buf.slice(0, Math.min(off, buf.length));
}

// ---------- Dalga boyu tablosu: aynı yayın sürümü + dedektör için hep aynı, bu yüzden ona göre önbelleğe alınır ----------
function checkURL(url) {
  if (!url.startsWith(IBE_PREFIX) || !/\.fits$/.test(url) || url.includes("..")) throw new Error("izin verilmeyen adres");
}
function waveKey(u) {
  const url = u.searchParams.get("url") || ""; checkURL(url);
  const m = url.match(/spherex\/((?:qr|dr)\d+)\/.*\/(\d)\/level2_[^/]*_(l2b[a-z_]*-v\d+)-/);
  if (!m) throw new Error("tanınmayan dosya adı");
  return `${u.origin}/api/spherex/dalga?k=${m[1]}-${m[3]}-D${m[2]}&v=2`; // v: tablo biçimi değişirse artır
}
async function waveTable(u) {
  const url = u.searchParams.get("url") || ""; checkURL(url);
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90);
  let hdu = null;
  try { hdu = await zamanli(dalgaS3(url), 12000); } catch (e) {}
  if (!hdu) {
    const r = await fetch(`${url}?center=${ra},${dec}&size=8pix`);
    if (!r.ok) throw new Error("IRSA kesit " + r.status);
    hdu = await findHDU(r.body, "WCS-WAVE");
  }
  if (!hdu) throw new Error("WCS-WAVE bulunamadı");
  // Sütunlar: X(nxJ), Y(nyJ), VALUES(2·nx·ny E: [dalga, bant genişliği] × x × y); boyutlar dedektöre göre değişir
  const dv = new DataView(hdu.data.buffer, hdu.data.byteOffset, hdu.data.byteLength);
  const count = k => parseInt(hdu.cards[k]) || 0;
  const nx = count("TFORM1"), ny = count("TFORM2");
  if (!nx || !ny || count("TFORM3") !== 2 * nx * ny) throw new Error("beklenmeyen WCS-WAVE biçimi");
  const ints = (o, n) => Array.from({ length: n }, (_, i) => dv.getInt32(o + i * 4));
  const vals = Array.from({ length: 2 * nx * ny }, (_, i) => dv.getFloat32(4 * (nx + ny) + i * 4));
  return json({ nx, ny, x: ints(0, nx), y: ints(4 * nx, ny), wl: vals.filter((_, i) => i % 2 === 0), bw: vals.filter((_, i) => i % 2 === 1) });
}

// Akışta adı verilen HDU'yu bul; öncekilerin verisini okuyup atar (bellekte tutmaz)
async function findHDU(stream, name) {
  const reader = stream.getReader();
  let buf = new Uint8Array(0);
  const need = async n => {
    while (buf.length < n) {
      const { value, done } = await reader.read();
      if (done) return false;
      const b = new Uint8Array(buf.length + value.length); b.set(buf); b.set(value, buf.length); buf = b;
    }
    return true;
  };
  const skip = async n => { // n bayt at
    while (n > 0) {
      if (!buf.length) { const { value, done } = await reader.read(); if (done) return false; buf = value; }
      const k = Math.min(n, buf.length); buf = buf.subarray(k); n -= k;
    }
    return true;
  };
  try {
    for (;;) {
      const cards = {};
      for (let end = false; !end;) {
        if (!(await need(2880))) return null;
        const blk = new TextDecoder("latin1").decode(buf.subarray(0, 2880)); buf = buf.subarray(2880);
        for (let i = 0; i < 2880; i += 80) {
          const card = blk.slice(i, i + 80), k = card.slice(0, 8).trim();
          if (k === "END") { end = true; break; }
          if (card[8] === "=") cards[k] = card.slice(10).split("/")[0].trim().replace(/^'|'$/g, "").trim();
        }
      }
      const naxis = +(cards.NAXIS || 0);
      let size = 0;
      if (naxis > 0) { size = Math.abs(+cards.BITPIX) / 8; for (let i = 1; i <= naxis; i++) size *= +cards["NAXIS" + i]; }
      size += +(cards.PCOUNT || 0);
      const padded = Math.ceil(size / 2880) * 2880;
      if (cards.EXTNAME === name) { if (!(await need(size))) return null; return { cards, data: buf.slice(0, size) }; }
      if (!(await skip(padded))) return null;
    }
  } finally { reader.cancel().catch(() => {}); }
}

// ---------- Ayak izi (s_region) → hedefin dedektör pikseli ----------
// Köşeler sırasıyla dedektör (0,0), (2040,0), (2040,2040), (0,2040); ters iki-doğrusal eşleme ±10 piksel doğrulukta
// (gerçek kesit başlıklarıyla karşılaştırıldı) — dalga boyunu indirmeden önce tahmin etmeye yeter.
function tanProj(ra, dec, ra0, dec0) {
  const r = Math.PI / 180, a = ra * r, d = dec * r, a0 = ra0 * r, d0 = dec0 * r;
  const D = Math.sin(d) * Math.sin(d0) + Math.cos(d) * Math.cos(d0) * Math.cos(a - a0);
  return [Math.cos(d) * Math.sin(a - a0) / D, (Math.sin(d) * Math.cos(d0) - Math.cos(d) * Math.sin(d0) * Math.cos(a - a0)) / D];
}
function detPos(region, ra, dec) {
  const n = (region || "").split(/\s+/).slice(2).map(Number);
  if (n.length < 8 || n.some(x => !isFinite(x))) return {};
  const C = [0, 2, 4, 6].map(i => [n[i], n[i + 1]]);
  const ra0 = C[0][0] + C.slice(1).reduce((s, c) => s + (((c[0] - C[0][0] + 540) % 360) - 180), 0) / 4, dec0 = C.reduce((s, c) => s + c[1], 0) / 4;
  const [[ax, ay], [bx, by], [cx, cy], [dx, dy]] = C.map(c => tanProj(c[0], c[1], ra0, dec0)), [qx, qy] = tanProj(ra, dec, ra0, dec0);
  let u = 0.5, v = 0.5;
  for (let it = 0; it < 20; it++) { // çift doğrusal ters dönüşüm (Newton), genelde 3–4 adımda yakınsar
    const fx = (1 - u) * (1 - v) * ax + u * (1 - v) * bx + u * v * cx + (1 - u) * v * dx - qx;
    const fy = (1 - u) * (1 - v) * ay + u * (1 - v) * by + u * v * cy + (1 - u) * v * dy - qy;
    const ux = -(1 - v) * ax + (1 - v) * bx + v * cx - v * dx, uy = -(1 - v) * ay + (1 - v) * by + v * cy - v * dy;
    const vx = -(1 - u) * ax - u * bx + u * cx + (1 - u) * dx, vy = -(1 - u) * ay - u * by + u * cy + (1 - u) * dy;
    const det = ux * vy - uy * vx; if (!det) return {};
    const du = (fx * vy - fy * vx) / det, dv = (ux * fy - uy * fx) / det;
    u -= du; v -= dv; if (Math.abs(du) + Math.abs(dv) < 1e-7) break;
  }
  return { px: Math.round(u * 2040), py: Math.round(v * 2040) };
}

// ---------- Fotometri: küçük kesitte açıklık toplamı − halka arka planı ----------
const FOTO_R = 2, FOTO_IN = 3.5, FOTO_OUT = 6, FOTO_SIZE = 15;
const PIX_SR = (6.15 / 206264.806) ** 2; // piksel katı açısı; 1 MJy/sr·piksel = PIX_SR·1e12 µJy
const BAD = 64 | 512 | 1024 | 2048 | 131072 | 524288; // istemcideki "önerilen" maske
async function photometry(u, ctx) {
  const url = u.searchParams.get("url") || ""; checkURL(url);
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90);
  let bytes = null;
  try { bytes = await zamanli(kesitS3(url, ra, dec, FOTO_SIZE), 12000); } catch (e) {}
  if (!bytes) {
    const r = await fetch(`${url}?center=${ra},${dec}&size=${FOTO_SIZE}pix`);
    if (!r.ok) throw new Error("IRSA kesit " + r.status);
    bytes = await readHDUs(r.body, 5);
  }
  const hdus = parseHDUs(bytes);
  const img = hdus.IMAGE, flg = hdus.FLAGS, vr = hdus.VARIANCE, zod = hdus.ZODI;
  if (!img) throw new Error("IMAGE yok");
  const h = img.h, W = h.NAXIS1, H = h.NAXIS2;
  const [tx, ty] = skyToPix(h)(ra, dec);
  let s = 0, v = 0, na = 0, fl = 0, sat = 0; const bg = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x, d = Math.hypot(x - tx, y - ty), f = flg ? flg.data[k] : 0;
    const val = img.data[k] - (zod && isFinite(zod.data[k]) ? zod.data[k] : 0);
    if (d <= FOTO_R) {
      fl |= f; if (f & 2) sat++;
      if (!(f & BAD) && isFinite(val)) { s += val; v += vr && isFinite(vr.data[k]) ? vr.data[k] : 0; na++; }
    } else if (d >= FOTO_IN && d <= FOTO_OUT && !(f & BAD) && isFinite(val)) bg.push(val); // SOURCE pikselleri çok (~%70), medyan yeter
  }
  const nAll = [...Array(W * H).keys()].filter(k => Math.hypot(k % W - tx, Math.floor(k / W) - ty) <= FOTO_R).length;
  bg.sort((a, b) => a - b);
  const sky = bg.length >= 8 ? bg[bg.length >> 1] : 0;
  const k2u = PIX_SR * 1e12;
  const ok = na >= Math.max(3, 0.7 * nAll) && bg.length >= 8;
  // Dalga boyu: aynı önbellekteki WCS-WAVE tablosundan, hedef pikseli için
  let wl = null, bw = null;
  try {
    const key = waveKey(new URL(`${u.origin}/api/spherex/dalga?${new URLSearchParams({ url, ra, dec })}`));
    const tr = await cached(key, ctx, 86400 * 30, () => waveTable(new URL(`${u.origin}/x?${new URLSearchParams({ url, ra, dec })}`)));
    const tab = await tr.clone().json();
    const w = waveAt(tab, h, tx, ty); if (w) { wl = +w.wl.toFixed(4); bw = +w.bw.toFixed(4); }
  } catch (e) {}
  return json({
    mjd: h["MJD-AVG"], det: h.DETECTOR, wl, bw, ok, sat,
    f: ok ? +((s - sky * na) * (nAll / na) * k2u).toFixed(2) : null,
    e: ok ? +(Math.sqrt(v) * (nAll / na) * k2u).toFixed(2) : null,
    flags: fl, x: +tx.toFixed(2), y: +ty.toFixed(2),
  });
}

function parseHDUs(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {}; let off = 0;
  while (off + 2880 <= bytes.length) {
    const h = {}; let end = false;
    while (!end && off + 2880 <= bytes.length) {
      const blk = new TextDecoder("latin1").decode(bytes.subarray(off, off + 2880)); off += 2880;
      for (let i = 0; i < 2880; i += 80) {
        const card = blk.slice(i, i + 80), k = card.slice(0, 8).trim();
        if (k === "END") { end = true; break; }
        if (card[8] !== "=") continue;
        const v = card.slice(10), m = v.match(/^\s*'((?:[^']|'')*)'/);
        h[k] = m ? m[1].replace(/''/g, "'").trim() : parseFloat(v.split("/")[0]);
      }
    }
    const nax = h.NAXIS | 0, bp = h.BITPIX; let size = 0, data = null;
    if (nax > 0) { size = Math.abs(bp) / 8; for (let i = 1; i <= nax; i++) size *= h["NAXIS" + i]; size += h.PCOUNT || 0; }
    if (nax === 2 && (bp === -32 || bp === 32) && off + size <= bytes.length) {
      const n = h.NAXIS1 * h.NAXIS2; data = bp === -32 ? new Float32Array(n) : new Int32Array(n);
      for (let i = 0; i < n; i++) data[i] = bp === -32 ? dv.getFloat32(off + i * 4) : dv.getInt32(off + i * 4);
    }
    if (h.EXTNAME) out[h.EXTNAME] = { h, data };
    off += Math.ceil(size / 2880) * 2880;
  }
  return out;
}

// Gökyüzü → 0 tabanlı kesit pikseli (TAN + ters SIP); sayfadaki skyToPix ile aynı
function skyToPix(h) {
  const r = Math.PI / 180, a0 = h.CRVAL1 * r, d0 = h.CRVAL2 * r, sd0 = Math.sin(d0), cd0 = Math.cos(d0);
  const c1 = h.CDELT1 ?? 1, c2 = h.CDELT2 ?? 1;
  const m = [(h.PC1_1 ?? 1) * c1, (h.PC1_2 ?? 0) * c1, (h.PC2_1 ?? 0) * c2, (h.PC2_2 ?? 1) * c2];
  const det = m[0] * m[3] - m[1] * m[2], inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  const sip = (pre, ord) => { const t = []; for (let p = 0; p <= ord; p++) for (let q = 0; q <= ord - p; q++) { const v = h[`${pre}_${p}_${q}`]; if (v) t.push([p, q, v]); } return t; };
  const AP = sip("AP", h.AP_ORDER | 0), BP = sip("BP", h.BP_ORDER | 0);
  return (ra, dec) => {
    const a = ra * r, d = dec * r, sd = Math.sin(d), cd = Math.cos(d), da = a - a0, ca = Math.cos(da);
    const D = sd * sd0 + cd * cd0 * ca;
    const x = cd * Math.sin(da) / D / r, y = (sd * cd0 - cd * sd0 * ca) / D / r;
    const U = inv[0] * x + inv[1] * y, V = inv[2] * x + inv[3] * y;
    let du = 0, dvv = 0; for (const [p, q, v] of AP) du += v * U ** p * V ** q; for (const [p, q, v] of BP) dvv += v * U ** p * V ** q;
    return [U + du + h.CRPIX1 - 1, V + dvv + h.CRPIX2 - 1];
  };
}

// WCS-WAVE tablosundan (kesit pikseli x,y için) merkez dalga boyu ve bant genişliği; sayfadaki waveAt ile aynı
function waveAt(tab, h, x, y) {
  if (!tab || !tab.nx || h.CRPIX1W == null) return null;
  const px = h.CRVAL1W + (h.CDELT1W || 1) * ((x + 1) - h.CRPIX1W), py = h.CRVAL2W + (h.CDELT2W || 1) * ((y + 1) - h.CRPIX2W);
  const seg = (A, v) => { let i = 0; while (i < A.length - 2 && v > A[i + 1]) i++; return [i, Math.max(0, Math.min(1, (v - A[i]) / ((A[i + 1] - A[i]) || 1)))]; };
  const [i, fx] = seg(tab.x, px), [j, fy] = seg(tab.y, py), at = (V, a, b) => V[b * tab.nx + a];
  const bil = V => at(V, i, j) * (1 - fx) * (1 - fy) + at(V, i + 1, j) * fx * (1 - fy) + at(V, i, j + 1) * (1 - fx) * fy + at(V, i + 1, j + 1) * fx * fy;
  return { wl: bil(tab.wl), bw: bil(tab.bw) };
}

// ---------- Kataloglar: IRSA TAP üzerinden Gaia DR3 ve CatWISE2020 ----------
// Dönen satır: [ra, dec, pmra, pmdec (mas/yıl), pm hatası (mas/yıl), paralaks (mas) | null, kadir, ad]
const CATS = {
  gaia: {
    ep: 2016.0, ad: "Gaia DR3",
    q: (ra, dec, r, fast) => `SELECT TOP 4000 source_id, ra, dec, pmra, pmdec, pmra_error, pmdec_error, parallax, phot_g_mean_mag FROM gaia_dr3_source
      WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${r}))=1 AND phot_g_mean_mag < 20.5${fast ? " AND pmra*pmra+pmdec*pmdec > 2500" : ""}`,
    row: o => [+o.ra, +o.dec, num0(o.pmra), num0(o.pmdec), Math.hypot(num0(o.pmra_error), num0(o.pmdec_error)), o.parallax === "" ? null : +(+o.parallax).toFixed(3), +(+o.phot_g_mean_mag).toFixed(2), "Gaia DR3 " + o.source_id],
  },
  catwise: {
    ep: 2015.4, ad: "CatWISE2020", // ra_pm/dec_pm MJD 57170 epoğunda; pm yay saniyesi/yıl
    q: (ra, dec, r, fast) => `SELECT TOP 4000 source_name, ra_pm, dec_pm, pmra, pmdec, sigpmra, sigpmdec, w1mpro_pm, w2mpro_pm FROM catwise_2020
      WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${r}))=1${fast ? " AND pmra*pmra+pmdec*pmdec > 0.0025" : ""}`,
    row: o => [+o.ra_pm, +o.dec_pm, num0(o.pmra) * 1000, num0(o.pmdec) * 1000, Math.hypot(num0(o.sigpmra), num0(o.sigpmdec)) * 1000, null,
      o.w2mpro_pm === "" ? null : +(+o.w2mpro_pm).toFixed(2), "CatWISE " + o.source_name],
  },
};
const num0 = v => (v === "" || v == null || !isFinite(+v)) ? 0 : +v;
async function catalog(u) {
  const k = u.searchParams.get("k"), C = CATS[k];
  if (!C) throw new Error("bilinmeyen katalog");
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90), r = num(u.searchParams.get("r") || 0.05, 0.002, 0.75);
  const fast = r > 0.12; // geniş alanda yalnız >50 mas/yıl
  const q = new URLSearchParams({ QUERY: C.q(ra, dec, r, fast).replace(/\s+/g, " "), FORMAT: "csv" });
  const res = await fetch(`${IRSA}/TAP/sync?${q}`);
  if (!res.ok) throw new Error("IRSA TAP " + res.status);
  const rows = parseCSV(await res.text()).filter(x => x.length > 1);
  const h = rows.shift() || [];
  const src = rows.map(x => C.row(Object.fromEntries(h.map((k, i) => [k, x[i]])))).filter(s => isFinite(s[0]) && isFinite(s[1]))
    .map(s => [+s[0].toFixed(6), +s[1].toFixed(6), +s[2].toFixed(2), +s[3].toFixed(2), +s[4].toFixed(2), s[5], s[6], s[7]]);
  return json({ k, ad: C.ad, ep: C.ep, r, yalnizHizli: fast, n: src.length, kaynaklar: src });
}

// ---------- Keşif: CatWISE'ta hızlı, Gaia ve SIMBAD'da karşılığı olmayan ya da türü bilinmeyen kaynaklar ----------
// CatWISE konumları/öz hareketleri 2015.4 epoğunda (yay saniyesi/yıl). Gaia eşleşmesi TAP_UPLOAD ile tek sorguda;
// SIMBAD (Harvard aynası, CDS kullanıcının ağından kapalı) daireler OR'lanarak parça parça.
const SIMBAD_TAP = "https://simbad.harvard.edu/simbad/sim-tap/sync";
const GALAKSI = /^(G|GiG|GiC|GiP|BiC|ClG|GrG|CGG|PaG|IG|SBG|bCG|LSB|EmG|H2G|AGN|LIN|SyG|Sy1|Sy2|Bla|BLL|QSO|rG|LeG|LeQ|LeI|AG\?|G\?|Q\?|Bz\?|BL\?|C\?G|Gr\?|SC\?|Sy\?|rG\?)$/;
async function discover(u) {
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90), r = num(u.searchParams.get("r") || 0.5, 0.05, 1);
  const pmMin = num(u.searchParams.get("pm") || 0.3, 0.1, 5);
  const q = `SELECT TOP 400 source_name, ra, dec, ra_pm, dec_pm, pmra, pmdec, sigpmra, sigpmdec, w1mpro_pm, w2mpro_pm, nb, ab_flags, cc_flags FROM catwise_2020
    WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${r}))=1 AND pmra*pmra+pmdec*pmdec > ${pmMin * pmMin} AND w2mpro_pm < 16.5`;
  let res; // IRSA ara sıra 403/5xx veriyor: bir kez daha dene
  for (let k = 0; k < 2; k++) {
    res = await fetch(`${IRSA}/TAP/sync?${new URLSearchParams({ QUERY: q.replace(/\s+/g, " "), FORMAT: "csv" })}`);
    if (res.ok) break;
    await new Promise(w => setTimeout(w, 2000));
  }
  if (!res.ok) throw new Error("IRSA TAP " + res.status);
  const all = csvObjects(await res.text());
  // Öz hareketin anlamlılığı: yalnız ≥5σ hareket. ra0/dec0: CatWISE'ın hareketsiz çözümü (sahte hareketli galaksiler orada)
  const C = all.map(o => {
    const pmra = +o.pmra * 1000, pmdec = +o.pmdec * 1000, pm = Math.hypot(pmra, pmdec), err = Math.hypot(+o.sigpmra, +o.sigpmdec) * 1000;
    const w1 = o.w1mpro_pm === "" ? null : +o.w1mpro_pm, w2 = o.w2mpro_pm === "" ? null : +o.w2mpro_pm;
    return { ad: "CatWISE " + o.source_name, ra: +o.ra_pm, dec: +o.dec_pm, ep: 2015.4, ra0: +o.ra, dec0: +o.dec,
      pmra: +pmra.toFixed(1), pmdec: +pmdec.toFixed(1), pm: +pm.toFixed(1), pmerr: +err.toFixed(1),
      snr: +(pm / (err || 1)).toFixed(1), w1, w2, w1w2: w1 != null && w2 != null ? +(w1 - w2).toFixed(2) : null, nb: +o.nb || 1, ab: o.ab_flags, cc: o.cc_flags };
  }).filter(c => isFinite(c.ra) && c.snr >= 5).sort((a, b) => b.snr - a.snr).slice(0, 150);
  if (!C.length) return json({ ra, dec, r, pmMin, n: 0, toplam: all.length, adaylar: [] });

  const cosd = d => Math.cos(d * Math.PI / 180);
  const at = (o, pmra, pmdec, from, to) => [o.ra + pmra / 3.6e6 * (to - from) / cosd(o.dec), o.dec + pmdec / 3.6e6 * (to - from)]; // mas/yıl
  const sepAS = (a, b, d) => Math.hypot((a[0] - b[0]) * cosd(d), a[1] - b[1]) * 3600;

  // Gaia DR3: CatWISE konumunun 6″ çevresi; eşleşme Gaia'nın kendi hareketiyle 2015.4'e taşınarak
  const gaia = new Map();
  try {
    const vot = `<?xml version="1.0"?><VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE><TABLE>`
      + `<FIELD name="id" datatype="int"/><FIELD name="ra" datatype="double" unit="deg"/><FIELD name="dec" datatype="double" unit="deg"/><DATA><TABLEDATA>`
      + C.map((c, i) => `<TR><TD>${i}</TD><TD>${c.ra}</TD><TD>${c.dec}</TD></TR><TR><TD>${i}</TD><TD>${c.ra0}</TD><TD>${c.dec0}</TD></TR>`).join("") + `</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>`;
    // Çok parçalı gövde elle kurulur: Workers FormData'sının dosya parçasını IRSA bulamıyor
    const B = "----kesif" + Date.now();
    const part = (k, v, file) => `--${B}\r\nContent-Disposition: form-data; name="${k}"${file ? `; filename="${file}"\r\nContent-Type: application/octet-stream` : ""}\r\n\r\n${v}\r\n`;
    const QG = `SELECT u.id, g.source_id, g.ra, g.dec, g.pmra, g.pmdec, g.parallax, g.phot_g_mean_mag FROM TAP_UPLOAD.c u, gaia_dr3_source g
      WHERE CONTAINS(POINT('ICRS',g.ra,g.dec),CIRCLE('ICRS',u.ra,u.dec,${6 / 3600}))=1`.replace(/\s+/g, " ");
    const body = part("QUERY", QG) + part("FORMAT", "csv") + part("LANG", "ADQL") + part("REQUEST", "doQuery") + part("UPLOAD", "c,param:t") + part("t", vot, "t.xml") + `--${B}--\r\n`;
    const g = await fetch(`${IRSA}/TAP/sync`, { method: "POST", body, headers: { "Content-Type": `multipart/form-data; boundary=${B}` } });
    if (!g.ok) throw new Error("Gaia " + g.status);
    for (const o of csvObjects(await g.text())) {
      const c = C[+o.id]; if (!c) continue;
      const gp = [+o.ra, +o.dec], gpm = [num0(o.pmra), num0(o.pmdec)];
      const g15 = at({ ra: gp[0], dec: gp[1] }, gpm[0], gpm[1], 2016.0, 2015.4);
      const sep = Math.min(sepAS(g15, [c.ra, c.dec], c.dec), sepAS(g15, [c.ra0, c.dec0], c.dec));
      if (sep > 4) continue;
      const prev = gaia.get(+o.id);
      if (!prev || sep < prev.sep) gaia.set(+o.id, { id: o.source_id, G: o.phot_g_mean_mag === "" ? null : +(+o.phot_g_mean_mag).toFixed(2),
        pmra: +gpm[0].toFixed(1), pmdec: +gpm[1].toFixed(1), plx: o.parallax === "" ? null : +(+o.parallax).toFixed(2), sep: +sep.toFixed(1) });
    }
  } catch (e) { var gaiaErr = String(e.message || e); }

  // SIMBAD: konumlar J2000; hareketli cisim için yarıçap öz hareket payıyla
  const simbad = new Map();
  try {
    for (let s = 0; s < C.length; s += 40) {
      const part = C.slice(s, s + 40);
      const where = part.map(c => `CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${c.ra},${c.dec},${((c.pm / 1000) * 16 + 6) / 3600}))=1`).join(" OR ");
      const sr = await fetch(SIMBAD_TAP, { method: "POST", body: new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv",
        QUERY: `SELECT main_id, otype, sp_type, ra, dec, pmra, pmdec FROM basic WHERE ${where}` }) });
      if (!sr.ok) throw new Error("SIMBAD " + sr.status + " " + (await sr.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200));
      for (const o of csvObjects(await sr.text())) {
        const p = [+o.ra, +o.dec], mpm = [num0(o.pmra), num0(o.pmdec)];
        part.forEach((c, k) => {
          // ya SIMBAD'ın kendi hareketiyle 2015.4'e, ya da CatWISE hareketiyle 2000'e taşı (SIMBAD'da hareket yoksa)
          const s1 = sepAS(at({ ra: p[0], dec: p[1] }, mpm[0], mpm[1], 2000, 2015.4), [c.ra, c.dec], c.dec);
          const s2 = sepAS(p, at(c, c.pmra, c.pmdec, 2015.4, 2000), c.dec);
          const s3 = sepAS(p, [c.ra0, c.dec0], c.dec); // hareketsiz cisim (galaksi): CatWISE'ın hareketsiz çözümünde
          const sep = Math.min(s1, s2, s3), id = s + k, prev = simbad.get(id);
          if (sep <= 5 && (!prev || sep < prev.sep)) simbad.set(id, { ad: o.main_id, tur: o.otype, sp: o.sp_type || "", sep: +sep.toFixed(1) });
        });
      }
    }
  } catch (e) { var simbadErr = String(e.message || e); }

  const adaylar = C.map((c, i) => {
    const g = gaia.get(i) || null, sm = simbad.get(i) || null;
    if (g) { const d = Math.hypot(g.pmra - c.pmra, g.pmdec - c.pmdec); g.uyum = d <= Math.max(3 * c.pmerr, 0.3 * c.pm, 40); }
    let sinif, not;
    // WISE artefakt bayrakları: D/d kırınım çizgisi, H/h parlak yıldız halesi, O/o optik hayalet, P/p kalıcılık (büyük harf: sahte, küçük: kirlenmiş)
    const art = (c.cc || "") + (c.ab || "");
    if (!sm && !g && /[DHOPdhop]/.test(art)) { sinif = "sahte"; not = `WISE artefakt bayrağı (${art.replace(/0/g, "") || art}): parlak komşu yıldızın kırınım/hale/kalıcılık izi`; }
    else if (sm && GALAKSI.test(sm.tur)) { sinif = "sahte"; not = `SIMBAD: ${sm.ad} (${sm.tur}) — galaksi/kuazar hareket etmez`; }
    else if (g && !g.uyum && Math.hypot(g.pmra, g.pmdec) < 0.3 * c.pm) { sinif = "sahte"; not = `Aynı yerde Gaia kaynağı var; gerçek hareketi ${Math.round(Math.hypot(g.pmra, g.pmdec))} mas/yıl, CatWISE'ın ${Math.round(c.pm)} değeri hatalı`; }
    else if (!g && !sm) { sinif = "bilinmeyen"; not = "Gaia'da da SIMBAD'da da yok"; }
    else if (!sm) { sinif = "adsiz"; not = "Gaia'da var, SIMBAD'da kaydı yok"; }
    else if (!sm.sp) { sinif = "tursuz"; not = `SIMBAD: ${sm.ad} (${sm.tur}), spektral türü yok`; }
    else { sinif = "bilinen"; not = `SIMBAD: ${sm.ad} · ${sm.sp}`; }
    if (g && !g.uyum && sinif !== "sahte") not += ` · Gaia hareketi ${Math.round(Math.hypot(g.pmra, g.pmdec))} mas/yıl, CatWISE'tan farklı (bindirme?)`;
    return { ...c, gaia: g, simbad: sm, sinif, not };
  });
  const SIRA = { bilinmeyen: 0, tursuz: 1, adsiz: 2, bilinen: 3, sahte: 4 };
  adaylar.sort((a, b) => SIRA[a.sinif] - SIRA[b.sinif] || b.snr - a.snr);
  // CatWISE bindirmelerde aynı yıldızı birkaç kez listeler: aynı Gaia kaynağına düşenlerden en anlamlısı kalsın
  const seenG = new Set();
  for (let i = 0; i < adaylar.length; i++) {
    const id = adaylar[i].gaia && adaylar[i].gaia.uyum && adaylar[i].gaia.id; if (!id) continue;
    const best = adaylar.filter(a => a.gaia && a.gaia.id === id).sort((a, b) => b.snr - a.snr)[0];
    if (seenG.has(id) || best !== adaylar[i]) { adaylar.splice(i--, 1); continue; }
    seenG.add(id);
  }
  return json({ ra, dec, r, pmMin, n: adaylar.length, toplam: all.length, hata: [gaiaErr, simbadErr].filter(Boolean), adaylar });
}
function csvObjects(t) {
  const rows = parseCSV(t).filter(x => x.length > 1), h = rows.shift() || [];
  if (h.length < 2) throw new Error("beklenmeyen TAP yanıtı: " + (t.match(/QUERY_STATUS[^>]*>([^<]*)/) || [, t.slice(0, 160)])[1].trim());
  return rows.map(x => Object.fromEntries(h.map((k, i) => [k, x[i]])));
}

// ---------- HiPS aynası (yalnız IRSA'nın /data/hips/ altı) ----------
async function hips(u) {
  const path = u.pathname.slice("/api/hips/".length).replace(/^v\d+\//, ""); // baştaki v2/ tarayıcı önbelleğini kırmak için
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes("..")) throw new Error("izin verilmeyen yol");
  // SPHEREx DR1 küpü (102 dalga boyu): sanal "SPHEREx/spherex_allsky_cube/f<k>/..." yolu k. kareyi düz bir HiPS gibi sunar.
  // IRSA'da karo adları Npix123_<k>.png / Allsky_<k>.png (k=0 ekisiz). Aladin küpü kendisi çözmek zorunda kalmaz.
  // Sahte renk: "SPHEREx/spherex_rgb/<r>-<g>-<b>/..." üç kanalın karolarını tek RGB PNG'de birleştirir
  const rgb = path.match(/^SPHEREx\/spherex_rgb\/(\d{1,3})-(\d{1,3})-(\d{1,3})\/(.+)$/);
  if (rgb) return await sxRGB(rgb.slice(1, 4).map(Number), rgb[4]);
  const kup = path.match(/^SPHEREx\/spherex_allsky_cube\/f(\d{1,3})\/(.+)$/);
  if (kup) {
    const k = +kup[1], rest = kup[2];
    if (k > 101) throw new Error("geçersiz kare");
    const kaynak = rest === "properties" ? rest : k ? rest.replace(/^(.*\/(?:Npix\d+|Allsky))(\.png|\.jpg)$/, `$1_${k}$2`) : rest;
    const r = await fetch(`${IRSA}/data/hips/SPHEREx/spherex_allsky_cube/${kaynak}`);
    if (!r.ok) return new Response(null, { status: r.status, headers: CORS });
    if (rest === "properties") {
      const txt = (await r.text()).split("\n").filter(l => !/^\s*(creator_did|publisher_did|hips_service_url\w*|ID|hips_cube\w*|data_cube\w*|custom_tile\w*|hips_progenitor_url)\s*=/.test(l))
        .map(l => l.replace(/^(\s*dataproduct_type\s*=).*/, "$1 image")).join("\n");
      return new Response(txt, { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
    }
    return new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") || "image/png", ...CORS } });
  }
  const r = await fetch(`${IRSA}/data/hips/${path}`);
  if (!r.ok) return new Response(null, { status: r.status, headers: CORS });
  if (path.endsWith("/properties")) {
    // Kimlik satırları varsa Aladin CDS MocServer'dan ayna aramaya çalışır (kullanıcının ağından erişilemiyor) ve takılır
    const txt = (await r.text()).split("\n").filter(l => !/^\s*(creator_did|publisher_did|hips_service_url\w*|ID)\s*=/.test(l)).join("\n");
    return new Response(txt, { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
  }
  return new Response(r.body, { headers: { "Content-Type": r.headers.get("Content-Type") || "application/octet-stream", ...CORS } });
}

// ---------- Seslendirme: ElevenLabs metinden sese ----------
// Anahtar koda ya da depoya girmez: `wrangler secret put ELEVENLABS_API_KEY` ile Cloudflare'de saklanır.
// Ses değiştirmek için ELEVENLABS_VOICE_ID (isteğe bağlı) gizli değişkeni ya da wrangler "vars" kullanılır.
// Kredi harcamasını sınırlamak için: yalnız bu sitenin kendi sayfalarından, en fazla 1200 karakter, aynı metin önbellekten.
const SES_MAX = 1200, SES_SES = "kLhAstPcnnPxqzk6gS5i", SES_MODEL = "eleven_v4";
async function ses(req, env, ctx) {
  if (req.method !== "POST") return json({ hata: "POST gerekli" }, 405);
  if (!env.ELEVENLABS_API_KEY) return json({ hata: "anahtar yok" }, 503);
  const u = new URL(req.url), origin = req.headers.get("Origin") || "";
  if (origin && new URL(origin).host !== u.host) return json({ hata: "izin yok" }, 403);
  let body; try { body = await req.json(); } catch { return json({ hata: "geçersiz istek" }, 400); }
  const metin = String(body.metin || "").replace(/\s+/g, " ").trim(), dil = body.dil === "en" ? "en" : "tr";
  if (!metin || metin.length > SES_MAX) return json({ hata: `metin 1–${SES_MAX} karakter olmalı` }, 400);
  const voice = env.ELEVENLABS_VOICE_ID || SES_SES;
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${voice}|${dil}|${metin}`)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const key = new Request(`${u.origin}/api/ses-onbellek/${hash}`, { method: "GET" });
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: metin, model_id: SES_MODEL, language_code: dil }),
  });
  if (!r.ok) { // ElevenLabs'ın kendi açıklaması (anahtarı içermez): izin, kota, ses bulunamadı…
    let d = ""; try { const e = await r.json(); d = (e.detail && (e.detail.message || e.detail.status)) || JSON.stringify(e.detail || e); } catch {}
    return json({ hata: "ElevenLabs " + r.status, ayrinti: String(d).slice(0, 300) }, 502);
  }
  const res = new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=2592000" } });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

// ---------- NEOSSat (Kanada Uzay Ajansı): CADC arşivi ----------
// Ham görüntülerde gökyüzü koordinatı (WCS) yok; yalnız uydunun baktığı yön (RA/DEC başlıkta) var.
const CADC_TAP = "https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/argus/sync";
const CADC_DATA = "https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/data/pub/NEOSSAT/";
async function neossatAra(u) {
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90);
  const q = `SELECT o.observationID, o.target_name, p.time_bounds_lower, p.time_exposure, a.contentLength, a.uri
    FROM caom2.Observation o JOIN caom2.Plane p ON o.obsID=p.obsID JOIN caom2.Artifact a ON a.planeID=p.planeID
    WHERE o.collection='NEOSSAT' AND a.uri LIKE 'cadc:NEOSSAT/NEOS_SCI_%.fits' AND o.target_name <> 'DARK'
    AND INTERSECTS(CIRCLE('ICRS',${ra},${dec},0.3), p.position_bounds)=1 ORDER BY p.time_bounds_lower`.replace(/\s+/g, " ");
  let r;
  for (let i = 0; i < 3; i++) {
    r = await fetch(CADC_TAP, { method: "POST", body: new URLSearchParams({ LANG: "ADQL", FORMAT: "csv", QUERY: q }) });
    if (r.ok) break;
    await new Promise(w => setTimeout(w, 800 * (i + 1)));
  }
  if (!r.ok) throw new Error("CADC TAP " + r.status);
  const rows = csvObjects(await r.text());
  const seen = new Set();
  const out = rows.map(o => ({ id: o.observationID, hedef: o.target_name, mjd: +o.time_bounds_lower, poz: o.time_exposure === "" ? null : +(+o.time_exposure).toFixed(2), boy: +o.contentLength || 0 }))
    .filter(o => /^\d{10,16}$/.test(o.id) && isFinite(o.mjd) && !seen.has(o.id) && seen.add(o.id));
  return json({ ra, dec, n: out.length, gozlemler: out });
}
async function neossatDosya(u) {
  const id = u.searchParams.get("id") || "";
  if (!/^\d{10,16}$/.test(id)) throw new Error("geçersiz kimlik");
  const r = await fetch(`${CADC_DATA}NEOS_SCI_${id}.fits`);
  if (!r.ok) throw new Error("CADC " + r.status);
  return new Response(r.body, { headers: { "Content-Type": "application/fits", ...CORS } });
}

// ---------- CADC: diğer teleskopların açık görüntüleri (TAP ile bul, SODA ile hedef merkezli kesit al) ----------
// TESS (21″ piksel), APASS, radyo taramaları ve NEOSSat (kendi paneli var) dışarıda.
const CADC_SODA = "https://ws.cadc-ccda.hia-iha.nrc-cnrc.gc.ca/caom2ops/sync";
const CADC_KOL = ["CFHT", "CFHTMEGAPIPE", "HST", "JWST", "GEMINI", "SUBARU", "DAO", "OMM"];
async function cadcAra(u) {
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90), yr = num(u.searchParams.get("r") || 0, 0, 0.2);
  const bugun = new Date().toISOString().slice(0, 10);
  // HST/JWST'de yalnız birleştirilmiş son ürün (drz/drc, i2d); diğerlerinde ana bilim dosyası
  const q = `SELECT TOP 4000 o.collection, o.instrument_name, o.target_name, p.energy_bandpassName, p.time_bounds_lower, p.time_exposure, p.calibrationLevel, a.uri
    FROM caom2.Observation o JOIN caom2.Plane p ON o.obsID=p.obsID JOIN caom2.Artifact a ON a.planeID=p.planeID
    WHERE o.collection IN (${CADC_KOL.map(k => `'${k}'`).join(",")}) AND p.dataProductType='image' AND p.calibrationLevel>=1
    AND a.productType='science' AND a.contentType LIKE 'application/fits%'
    AND (p.dataRelease IS NULL OR p.dataRelease < '${bugun}') AND p.time_bounds_lower IS NOT NULL
    AND ((o.collection NOT IN ('HST','JWST')) OR a.uri LIKE '%_drz.fits' OR a.uri LIKE '%_drc.fits' OR a.uri LIKE '%_i2d.fits')
    AND INTERSECTS(${yr > 0 ? `CIRCLE('ICRS',${ra},${dec},${yr})` : `POINT('ICRS',${ra},${dec})`}, p.position_bounds)=1 ORDER BY p.time_bounds_lower`.replace(/\s+/g, " ");
  let r;
  for (let i = 0; i < 3; i++) {
    r = await fetch(CADC_TAP, { method: "POST", body: new URLSearchParams({ LANG: "ADQL", FORMAT: "csv", QUERY: q }) });
    if (r.ok) break;
    await new Promise(w => setTimeout(w, 800 * (i + 1)));
  }
  if (!r.ok) throw new Error("CADC TAP " + r.status);
  const seen = new Set(), out = [];
  for (const o of csvObjects(await r.text())) {
    if (seen.has(o.uri) || !/^(cadc|mast|gemini):[A-Za-z0-9_./-]+$/.test(o.uri)) continue;
    seen.add(o.uri);
    out.push({ kol: o.collection, alet: o.instrument_name, hedef: o.target_name, bant: o.energy_bandpassName, mjd: +o.time_bounds_lower,
      poz: o.time_exposure === "" ? null : +(+o.time_exposure).toFixed(1), sev: +o.calibrationLevel, uri: o.uri });
  }
  return json({ ra, dec, n: out.length, goruntuler: out });
}
async function cadcKesit(u) {
  const uri = u.searchParams.get("uri") || "";
  if (!/^(cadc|mast|gemini):[A-Za-z0-9_./-]+$/.test(uri) || uri.includes("..")) throw new Error("izin verilmeyen dosya");
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90), r = num(u.searchParams.get("r") || 0.02, 0.003, 0.06);
  const res = await fetch(`${CADC_SODA}?${new URLSearchParams({ ID: uri, CIRCLE: `${ra} ${dec} ${r}` })}`);
  if (res.status === 400) return json({ hata: "kesit alanı görüntünün dışında" }, 404);
  if (!res.ok) throw new Error("CADC kesit " + res.status);
  // Çok büyük kesitleri kes (tarayıcıyı ve önbelleği şişirmesin)
  const reader = res.body.getReader(), parcalar = []; let boy = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; boy += value.length; if (boy > 12e6) { reader.cancel().catch(() => {}); return json({ hata: "kesit çok büyük" }, 413); } parcalar.push(value); }
  const b = new Uint8Array(boy); let o = 0; for (const p of parcalar) { b.set(p, o); o += p.length; }
  return new Response(b, { headers: { "Content-Type": "application/fits", ...CORS } });
}

// ---------- SkyBoT (IMCCE): verilen anda bir dairedeki bilinen Güneş Sistemi cisimleri ----------
// Konumlar yer merkezli (-loc=500); SPHEREx alçak yörüngede, aradaki paralaks ana kuşak için birkaç yay saniyesi.
async function skybot(u) {
  const ra = num(u.searchParams.get("ra"), 0, 360), dec = num(u.searchParams.get("dec"), -90, 90), r = num(u.searchParams.get("r") || 0.3, 0.01, 2);
  const t = u.searchParams.get("t") || "";
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(t)) throw new Error("geçersiz zaman");
  const q = new URLSearchParams({ "-ep": t, "-ra": ra, "-dec": dec, "-rd": r, "-mime": "json", "-output": "basic", "-loc": "500", "-filter": "0", "-objFilter": "111", "-from": "ArpaSphere" });
  const res = await fetch(`https://ssp.imcce.fr/webservices/skybot/api/conesearch.php?${q}`);
  if (res.status === 204) return json({ t, n: 0, cisimler: [] });
  if (!res.ok) throw new Error("SkyBoT " + res.status);
  const sex = (s, saat) => { const p = String(s).trim().split(/\s+/).map(Number), eksi = /^-/.test(String(s).trim()); const v = Math.abs(p[0]) + (p[1] || 0) / 60 + (p[2] || 0) / 3600; return (eksi ? -v : v) * (saat ? 15 : 1); };
  const L = await res.json();
  const cisimler = (Array.isArray(L) ? L : []).map(o => ({ ad: o.Name, no: o.Num === "-" ? null : o.Num, sinif: o.Class, v: +o["VMag (mag)"],
    ra: +sex(o["RA (hms)"], true).toFixed(6), dec: +sex(o["DEC (dms)"], false).toFixed(6), dra: +o["dRA (arcsec/h)"], ddec: +o["dDEC (arcsec/h)"] }))
    .filter(o => isFinite(o.ra) && isFinite(o.dec)).sort((a, b) => a.v - b.v).slice(0, 200);
  return json({ t, n: cisimler.length, cisimler });
}

// ---------- İsim çözümleme: CDS Sesame (SIMBAD), olmazsa Harvard aynası. Konum J2000 (epok 2000), öz hareket mas/yıl, paralaks mas ----------
// Kullanıcının ağından CDS'ye erişim kapalı olabildiği için tarayıcı yerine Worker sorar; sonuç 30 gün önbellekte.
async function coz(u) {
  const ad = (u.searchParams.get("ad") || "").trim().slice(0, 80);
  if (!ad) return json({ hata: "ad yok" }, 400);
  const yollar = ["https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/S?", "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-ox/S?"];
  const al = (x, t) => { const m = x.match(new RegExp(`<${t}>([^<]*)</${t}>`)); return m ? m[1].trim() : null; };
  for (const y of yollar) {
    try {
      const r = await fetch(y + encodeURIComponent(ad), { redirect: "follow", cf: { cacheTtl: 86400 } });
      if (!r.ok) continue;
      const x = await r.text();
      const ra = parseFloat(al(x, "jradeg")), dec = parseFloat(al(x, "jdedeg"));
      if (!isFinite(ra) || !isFinite(dec)) { if (/<Target/.test(x) && !/<Resolver/.test(x)) return json({ bulunamadi: true, ad }); continue; }
      const pmB = x.match(/<pm>([\s\S]*?)<\/pm>/), plxB = x.match(/<plx>([\s\S]*?)<\/plx>/);
      const pmra = pmB ? parseFloat(al(pmB[1], "pmRA")) : NaN, pmdec = pmB ? parseFloat(al(pmB[1], "pmDE")) : NaN, plx = plxB ? parseFloat(al(plxB[1], "v")) : NaN;
      return json({ ad, ana: (al(x, "oname") || ad).replace(/\s+/g, " "), ra, dec, tur: al(x, "otype"), sp: al(x, "spType") || "",
        pmra: isFinite(pmra) ? pmra : null, pmdec: isFinite(pmdec) ? pmdec : null, plx: isFinite(plx) ? plx : null, kaynak: y.includes("harvard") ? "Sesame (Harvard aynası)" : "Sesame (CDS)" });
    } catch (e) {}
  }
  return json({ hata: "isim çözümleme servisine ulaşılamadı", ad }, 502);
}

// ---------- SPHEREx sahte renk karoları (PNG çöz → 3 kanal → RGB PNG) ----------
async function sxRGB(kanallar, rest) {
  if (kanallar.some(k => k > 101)) throw new Error("geçersiz kare");
  if (rest === "properties") {
    const txt = ["hips_version = 1.4", "hips_frame = equatorial", "hips_order = 5", "hips_order_min = 0", "hips_tile_width = 512",
      "hips_tile_format = png", "dataproduct_type = image", "obs_title = SPHEREx DR1 sahte renk", `hips_initial_fov = 180`].join("\n");
    return new Response(txt, { headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
  }
  if (!/^Norder\d\/Dir\d+\/Npix\d+\.png$/.test(rest)) return new Response(null, { status: 404, headers: CORS }); // Allsky üretmiyoruz (çok büyük)
  const urls = kanallar.map(k => `${IRSA}/data/hips/SPHEREx/spherex_allsky_cube/${k ? rest.replace(/\.png$/, `_${k}.png`) : rest}`);
  const res = await Promise.all(urls.map(u => fetch(u)));
  if (res.some(r => !r.ok)) return new Response(null, { status: 404, headers: CORS });
  const img = await Promise.all(res.map(async r => pngGri(new Uint8Array(await r.arrayBuffer()))));
  const { w, h } = img[0];
  if (img.some(x => x.w !== w || x.h !== h)) throw new Error("karo boyları farklı");
  // RGB satırları: her satır başında filtre baytı 0
  const ham = new Uint8Array(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) { const o = y * (1 + 3 * w); for (let x = 0; x < w; x++) { const i = y * w + x, p = o + 1 + 3 * x; ham[p] = img[0].v[i]; ham[p + 1] = img[1].v[i]; ham[p + 2] = img[2].v[i]; } }
  return new Response(await pngYaz(w, h, ham), { headers: { "Content-Type": "image/png", ...CORS } });
}
async function akisla(veri, akis) { return new Uint8Array(await new Response(new Blob([veri]).stream().pipeThrough(akis)).arrayBuffer()); }
// 8 bit PNG (paletli, gri, RGB, RGBA; taramasız) → gri değer dizisi (paletin/rengin kırmızı kanalı; saydam piksel 0)
async function pngGri(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let i = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0, plte = null, trns = null; const idat = [];
  while (i < b.length) { const n = dv.getUint32(i), t = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]), d = b.subarray(i + 8, i + 8 + n);
    if (t === "IHDR") { w = dv.getUint32(i + 8); h = dv.getUint32(i + 12); bd = b[i + 16]; ct = b[i + 17]; il = b[i + 20]; }
    else if (t === "PLTE") plte = d; else if (t === "tRNS") trns = d; else if (t === "IDAT") idat.push(d); else if (t === "IEND") break;
    i += 12 + n; }
  if (bd !== 8 || il) throw new Error("desteklenmeyen PNG");
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]; if (!bpp) throw new Error("desteklenmeyen renk türü");
  let toplam = 0; for (const d of idat) toplam += d.length; const z = new Uint8Array(toplam); let o = 0; for (const d of idat) { z.set(d, o); o += d.length; }
  const r = await akisla(z, new DecompressionStream("deflate"));
  const sat = w * bpp, cur = new Uint8Array(sat), onc = new Uint8Array(sat), v = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = r[y * (sat + 1)], s = r.subarray(y * (sat + 1) + 1, (y + 1) * (sat + 1));
    for (let x = 0; x < sat; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, u = onc[x], c = x >= bpp ? onc[x - bpp] : 0; let p = s[x];
      if (f === 1) p += a; else if (f === 2) p += u; else if (f === 3) p += (a + u) >> 1;
      else if (f === 4) { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); p += pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
      cur[x] = p;
    }
    for (let x = 0; x < w; x++) {
      let g;
      if (ct === 3) { const k = cur[x]; g = trns && k < trns.length && trns[k] === 0 ? 0 : plte ? plte[3 * k] : k; }
      else if (ct === 6) g = cur[4 * x + 3] ? cur[4 * x] : 0; else g = cur[x * bpp];
      v[y * w + x] = g;
    }
    onc.set(cur);
  }
  return { w, h, v };
}
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(...parcalar) { let c = 0xffffffff; for (const p of parcalar) for (let i = 0; i < p.length; i++) c = CRC_T[(c ^ p[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function pngYaz(w, h, ham) {
  const z = await akisla(ham, new CompressionStream("deflate"));
  const parca = (tur, veri) => { const out = new Uint8Array(12 + veri.length), dv = new DataView(out.buffer), t = new TextEncoder().encode(tur);
    dv.setUint32(0, veri.length); out.set(t, 4); out.set(veri, 8); dv.setUint32(8 + veri.length, crc32(t, veri)); return out; };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const imza = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), A = parca("IHDR", ihdr), B = parca("IDAT", z), C = parca("IEND", new Uint8Array(0));
  const out = new Uint8Array(imza.length + A.length + B.length + C.length); let o = 0; for (const p of [imza, A, B, C]) { out.set(p, o); o += p.length; }
  return out;
}
