// SPHEREx kesitini IRSA'nın kesit servisi yerine doğrudan herkese açık S3 deposundan (nasa-irsa-spherex) üretir.
// Yalnız gereken satırlar HTTP Range ile okunur; sıkıştırılmış FLAGS katmanı (RICE_1) burada çözülür.
// Çıktı, IRSA kesitiyle aynı biçimde: IMAGE, FLAGS, VARIANCE, ZODI katmanları, kesite göre kaydırılmış WCS ile.
// Herhangi bir sorunda hata fırlatır; çağıran taraf IRSA'ya geri döner.

export const S3_KOK = "https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/";
const IBE = "https://irsa.ipac.caltech.edu/ibe/data/spherex/";
const ISTENEN = ["IMAGE", "FLAGS", "VARIANCE", "ZODI"];

async function aralik(url, a, b) {
  const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } });
  if (r.status !== 206 && r.status !== 200) throw new Error("S3 " + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// off konumundaki HDU başlığını oku: {kartlar (ham 80'lik satırlar), h (çözülmüş değerler), veri (veri başlangıcı)}
// on: önceden okunmuş baş bölge {a, buf}; başlık oradaysa yeni istek atılmaz
async function baslikOku(url, off, on) {
  let boy = 2880 * 10, buf = on && off >= on.a && off + boy <= on.a + on.buf.length ? on.buf.subarray(off - on.a, off - on.a + boy) : await aralik(url, off, off + boy - 1);
  for (;;) {
    const txt = new TextDecoder("latin1").decode(buf);
    for (let i = 0; i + 80 <= txt.length; i += 80) {
      if (txt.slice(i, i + 8).trim() === "END" && i % 80 === 0) {
        const kartlar = [], h = {};
        for (let j = 0; j < i; j += 80) {
          const c = txt.slice(j, j + 80); kartlar.push(c);
          if (c[8] !== "=") continue;
          const k = c.slice(0, 8).trim(), v = c.slice(10), m = v.match(/^\s*'((?:[^']|'')*)'/);
          h[k] = m ? m[1].replace(/''/g, "'").trim() : (/^\s*[TF]\s*(\/|$)/.test(v) ? v.trim()[0] === "T" : parseFloat(v.split("/")[0]));
        }
        return { kartlar, h, veri: off + Math.ceil((i + 80) / 2880) * 2880 };
      }
    }
    if (boy >= 2880 * 80) throw new Error("başlık bulunamadı");
    boy *= 2; buf = await aralik(url, off, off + boy - 1);
  }
}
const veriBoyu = h => { const n = h.NAXIS | 0; if (!n) return 0; let s = Math.abs(h.BITPIX) / 8; for (let i = 1; i <= n; i++) s *= h["NAXIS" + i]; return s + (h.PCOUNT || 0); };

// Gökyüzü → 0 tabanlı piksel (TAN + ters SIP); worker'daki skyToPix ile aynı
function gokPiksel(h) {
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
    let du = 0, dv = 0; for (const [p, q, v] of AP) du += v * U ** p * V ** q; for (const [p, q, v] of BP) dv += v * U ** p * V ** q;
    return [U + du + h.CRPIX1 - 1, V + dv + h.CRPIX2 - 1];
  };
}

// RICE_1 çözücü (cfitsio fits_rdecomp ile aynı algoritma), 32 bit tamsayı; sayılar 2^53'ün altında tutulur
const SIFIR_SAY = (() => { const t = new Uint8Array(256); for (let i = 1; i < 256; i++) t[i] = 32 - Math.clz32(i); return t; })(); // b'nin bit uzunluğu
export function riceCoz(c, nx, nblock, bytepix) {
  const fsbits = bytepix === 1 ? 3 : bytepix === 2 ? 4 : 5, fsmax = bytepix === 1 ? 6 : bytepix === 2 ? 14 : 25, bbits = 8 * bytepix;
  const out = new Int32Array(nx); let p = 0;
  let last = 0; for (let k = 0; k < bytepix; k++) last = last * 256 + c[p++];
  if (bytepix === 4) last = last | 0; else if (bytepix === 2) last = (last << 16) >> 16; else last = (last << 24) >> 24;
  const P2 = n => 2 ** n;
  let b = c[p++], nbits = 8;
  for (let i = 0; i < nx;) {
    nbits -= fsbits; while (nbits < 0) { b = b * 256 + c[p++]; nbits += 8; }
    const fs = Math.floor(b / P2(nbits)) - 1; b = b % P2(nbits);
    const imax = Math.min(i + nblock, nx);
    if (fs < 0) { for (; i < imax; i++) out[i] = last; }
    else if (fs === fsmax) {
      for (; i < imax; i++) {
        let k = bbits - nbits, diff = b * P2(k);
        for (k -= 8; k >= 0; k -= 8) { b = c[p++]; diff += b * P2(k); }
        if (nbits > 0) { b = c[p++]; diff += Math.floor(b / P2(-k)); b = b % P2(nbits); } else b = 0;
        diff = diff % P2(bbits);
        const v = diff % 2 ? -Math.floor(diff / 2) - 1 : diff / 2;
        last = (v + last) | 0; out[i] = last;
      }
    } else {
      for (; i < imax; i++) {
        while (b === 0) { nbits += 8; b = c[p++]; }
        const nzero = nbits - SIFIR_SAY[b];
        nbits -= nzero + 1; b -= P2(nbits);
        nbits -= fs; while (nbits < 0) { b = b * 256 + c[p++]; nbits += 8; }
        const diff = nzero * P2(fs) + Math.floor(b / P2(nbits)); b = b % P2(nbits);
        const v = diff % 2 ? -Math.floor(diff / 2) - 1 : diff / 2;
        last = (v + last) | 0; out[i] = last;
      }
    }
  }
  return out;
}

// FITS başlık kartı (80 karakter)
const kart = (k, v, yorum = "") => {
  const val = typeof v === "string" ? `'${v.replace(/'/g, "''").padEnd(8)}'` : typeof v === "boolean" ? (v ? "T" : "F") : String(v);
  return (k.padEnd(8) + "= " + (typeof v === "string" ? val.padEnd(20) : val.padStart(20)) + (yorum ? " / " + yorum : "")).slice(0, 80).padEnd(80);
};
function blokla(kartlar) { let s = kartlar.join("") + "END".padEnd(80); while (s.length % 2880) s += " "; return new TextEncoder().encode(s.replace(/[^\x20-\x7e]/g, " ")); }
const ATLA = /^(SIMPLE|XTENSION|BITPIX|NAXIS\d*|EXTEND|PCOUNT|GCOUNT|BZERO|BSCALE|Z\w+|TFORM\d+|TTYPE\d+|TUNIT\d+|THEAP|TFIELDS|CHECKSUM|DATASUM|END)$/;

// Bir katmanın kesit satırlarını oku (sıkıştırılmamış: doğrudan; RICE_1: satır tablosu + yığın, sonra çöz)
async function katmanVeri(url, hd, sik, W, S, x0, y0) {
  const h = hd.h;
  if (!sik) {
    if (h.BITPIX !== -32 && h.BITPIX !== 32) throw new Error("beklenmeyen BITPIX");
    const ham = await aralik(url, hd.veri + y0 * W * 4, hd.veri + (y0 + S) * W * 4 - 1), dv = new DataView(ham.buffer, ham.byteOffset, ham.byteLength);
    const veri = h.BITPIX === -32 ? new Float32Array(S * S) : new Int32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const q = (y * W + x0 + x) * 4; veri[y * S + x] = h.BITPIX === -32 ? dv.getFloat32(q) : dv.getInt32(q); }
    return veri;
  }
  if (h.ZCMPTYPE !== "RICE_1" || (h.ZTILE1 || W) !== W || (h.ZTILE2 || 1) !== 1 || h.NAXIS1 !== 8) throw new Error("desteklenmeyen sıkıştırma");
  if (h.ZBITPIX !== 32 && h.ZBITPIX !== 16 && h.ZBITPIX !== 8) throw new Error("beklenmeyen ZBITPIX");
  const blok = h.ZVAL1 || 32, bp = h.ZVAL2 || 4, heap = hd.veri + (h.THEAP || h.NAXIS1 * h.NAXIS2);
  const tb = await aralik(url, hd.veri + y0 * 8, hd.veri + (y0 + S) * 8 - 1), tv = new DataView(tb.buffer, tb.byteOffset, tb.byteLength);
  const sat = []; for (let y = 0; y < S; y++) sat.push([tv.getInt32(y * 8), tv.getInt32(y * 8 + 4)]);
  const a = Math.min(...sat.map(s => s[1])), b = Math.max(...sat.map(s => s[1] + s[0]));
  const hb = await aralik(url, heap + a, heap + b - 1);
  const veri = new Int32Array(S * S);
  sat.forEach(([n, o], y) => { const row = riceCoz(hb.subarray(o - a, o - a + n), W, blok, bp); for (let x = 0; x < S; x++) veri[y * S + x] = row[x0 + x]; });
  return veri;
}

// Dalga boyu tablosu (WCS-WAVE) katmanını S3'ten bul: {cards, data}; başlıklar sırayla yürünür, veri tek istekte
export async function dalgaS3(irsaUrl) {
  if (!irsaUrl.startsWith(IBE)) throw new Error("S3 yolu yok");
  const url = S3_KOK + irsaUrl.slice(IBE.length), on = { a: 0, buf: await aralik(url, 0, 2880 * 20 - 1) };
  let off = 0;
  for (let adim = 0; adim < 10; adim++) {
    const hd = await baslikOku(url, off, on), boy = veriBoyu(hd.h);
    if (hd.h.EXTNAME === "WCS-WAVE") {
      const cards = {}; for (const c of hd.kartlar) if (c[8] === "=") cards[c.slice(0, 8).trim()] = c.slice(10).split("/")[0].trim().replace(/^'|'$/g, "").trim();
      return { cards, data: await aralik(url, hd.veri, hd.veri + boy - 1) };
    }
    off = hd.veri + Math.ceil(boy / 2880) * 2880;
  }
  throw new Error("WCS-WAVE bulunamadı");
}

// Ana iş: IRSA görüntü adresi + gökyüzü merkezi + boyut → FITS baytları
export async function kesitS3(irsaUrl, ra, dec, size) {
  if (!irsaUrl.startsWith(IBE)) throw new Error("S3 yolu yok");
  const url = S3_KOK + irsaUrl.slice(IBE.length);
  // Başlıklar sırayla okunur (her biri bir sonrakinin yerini verir); katman verileri arka planda paralel iner.
  const on = { a: 0, buf: await aralik(url, 0, 2880 * 20 - 1) };
  const ana = await baslikOku(url, 0, on);
  let off = ana.veri + Math.ceil(veriBoyu(ana.h) / 2880) * 2880;
  const katman = {}, isler = [];
  let x0 = null, y0 = null, W = 0, H = 0, S = size;
  for (let adim = 0; adim < 8 && ISTENEN.some(k => !(k in katman)); adim++) {
    const hd = await baslikOku(url, off, on), h = hd.h, ad = h.EXTNAME;
    const sonraki = hd.veri + Math.ceil(veriBoyu(h) / 2880) * 2880;
    if (ISTENEN.includes(ad)) {
      const sik = h.ZIMAGE === true, w = sik ? h.ZNAXIS1 : h.NAXIS1, hh = sik ? h.ZNAXIS2 : h.NAXIS2;
      if (x0 === null) {
        if (ad !== "IMAGE") throw new Error("IMAGE ilk değil");
        W = w; H = hh; S = Math.min(size, W, H);
        const [px, py] = gokPiksel(h)(ra, dec);
        if (!(px > -S / 2 && py > -S / 2 && px < W + S / 2 && py < H + S / 2)) throw new Error("hedef görüntünün dışında");
        x0 = Math.max(0, Math.min(W - S, Math.round(px - S / 2 + 0.5)));
        y0 = Math.max(0, Math.min(H - S, Math.round(py - S / 2 + 0.5)));
      }
      if (w !== W || hh !== H) throw new Error("katman boyutları farklı");
      katman[ad] = null;
      isler.push(katmanVeri(url, hd, sik, W, S, x0, y0).then(veri => { katman[ad] = { h, kartlar: hd.kartlar, veri, ad }; }));
    }
    off = sonraki;
    if (ad === "EPSF" || ad === "WCS-WAVE") break;
  }
  await Promise.all(isler);
  if (ISTENEN.some(k => !katman[k])) throw new Error("katman eksik");
  // Çıktı FITS: boş ana HDU + 4 görüntü katmanı; WCS (CRPIX1/2 ve dalga boyu WCS'i CRPIX1W/2W) kesite göre kaydırılır
  const parcalar = [blokla([kart("SIMPLE", true), kart("BITPIX", 8), kart("NAXIS", 0), kart("EXTEND", true), kart("ORIGIN", "S3 kesit (ArpaSphere)")])];
  for (const ad of ISTENEN) {
    const K = katman[ad], tam = K.veri instanceof Float32Array;
    const ust = [kart("XTENSION", "IMAGE"), kart("BITPIX", tam ? -32 : 32), kart("NAXIS", 2), kart("NAXIS1", S), kart("NAXIS2", S), kart("PCOUNT", 0), kart("GCOUNT", 1)];
    // sıkıştırılmış FLAGS'in başlığında WCS yok: IMAGE'inkini kullan
    const kaynak = katman.IMAGE.kartlar.filter(c => c[8] === "=" || /^(COMMENT|HISTORY)/.test(c));
    const kendi = K.kartlar.filter(c => c[8] === "=");
    const harita = new Map(); for (const c of (ad === "FLAGS" ? kaynak : kendi)) harita.set(c.slice(0, 8).trim(), c);
    if (ad === "FLAGS") for (const c of kendi) { const k = c.slice(0, 8).trim(); if (!/^Z|^T|^THEAP|^PCOUNT|^GCOUNT|^NAXIS|^BITPIX|^XTENSION/.test(k)) harita.set(k, c); }
    for (const [k, c] of harita) {
      if (ATLA.test(k)) continue;
      const hv = (ad === "FLAGS" ? katman.IMAGE.h : K.h)[k];
      if (k === "CRPIX1" || k === "CRPIX1W") ust.push(kart(k, +(hv - x0).toFixed(6)));
      else if (k === "CRPIX2" || k === "CRPIX2W") ust.push(kart(k, +(hv - y0).toFixed(6)));
      else ust.push(c);
    }
    ust.push(kart("EXTNAME", ad));
    const hb = blokla(ust.filter((c, i, A) => !(c.startsWith("EXTNAME ") && i !== A.length - 1)));
    const db = new Uint8Array(Math.ceil(S * S * 4 / 2880) * 2880), dv = new DataView(db.buffer);
    for (let i = 0; i < S * S; i++) tam ? dv.setFloat32(i * 4, K.veri[i]) : dv.setInt32(i * 4, K.veri[i]);
    parcalar.push(hb, db);
  }
  const top = parcalar.reduce((a, p) => a + p.length, 0), out = new Uint8Array(top); let o = 0;
  for (const p of parcalar) { out.set(p, o); o += p.length; }
  return out;
}
