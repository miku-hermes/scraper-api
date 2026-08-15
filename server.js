// 自建刮削 API 服务
// 通过 Camofox 反检测浏览器爬起点中文网，提供 HTTP API
// GET /api/search?kw=书名        → 搜索书籍列表
// GET /api/detail?title=书名     → 精确匹配的书籍详情（含简介/作者/封面/标签）
// GET /api/cache/stats           → 缓存统计

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3200;
const CAMOFOX_URL = process.env.CAMOFOX_URL || 'http://172.18.0.5:9377';
const USER_ID = 'scraper-api';
const TIMEOUT_MS = 30000;

// ---------- 简单文件缓存（结果缓存 24h，避免重复爬） ----------
const CACHE_DIR = path.join(__dirname, 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const CACHE_TTL = 24 * 3600 * 1000;

function cacheGet(key) {
  try {
    const file = path.join(CACHE_DIR, key + '.json');
    if (!fs.existsSync(file)) return null;
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - d.ts > CACHE_TTL) return null;
    return d.data;
  } catch (e) { return null; }
}
function cacheSet(key, data) {
  try {
    const file = path.join(CACHE_DIR, key + '.json');
    fs.writeFileSync(file, JSON.stringify({ ts: Date.now(), data }));
  } catch (e) {}
}

// ---------- Camofox 交互 ----------
async function camofox(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(CAMOFOX_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await resp.json();
  } catch (e) {
    return { ok: false, error: e.message };
  } finally { clearTimeout(timer); }
}

// ---------- 爬起点搜索 ----------
async function qidianSearch(kw) {
  const tab = await camofox('/tabs', {
    url: `https://www.qidian.com/search?kw=${encodeURIComponent(kw)}`,
    userId: USER_ID,
    sessionKey: 'qidian',
    width: 1280, height: 800,
  });
  if (!tab.tabId) return { ok: false, error: 'Camofox 不可用' };
  const tabId = tab.tabId;
  try {
    await new Promise(r => setTimeout(r, 6000)); // 等 WAF 探测
    const expr = `(() => {
      const items = document.querySelectorAll('.book-mid-info');
      const out = [];
      items.forEach(el => {
        const t = el.querySelector('.book-info-title a');
        const authorEl = el.querySelector('.author .name');
        const catEls = el.querySelectorAll('.author a');
        const statusEl = el.querySelector('.author span');
        const introEl = el.querySelector('.intro');
        const imgEl = el.closest('li') ? el.closest('li').querySelector('img') : null;
        out.push({
          title: t ? (t.getAttribute('title') || t.innerText || '').replace(/在线阅读$/, '') : '',
          href: t ? t.getAttribute('href') : '',
          author: authorEl ? authorEl.innerText.trim() : '',
          category: catEls.length > 1 ? catEls[1].innerText.trim() : '',
          status: statusEl ? statusEl.innerText.trim() : '',
          intro: introEl ? introEl.innerText.trim() : '',
          cover: imgEl ? imgEl.src : '',
          bid: t ? (t.getAttribute('data-bid') || '') : '',
        });
      });
      return JSON.stringify({ count: items.length, books: out });
    })()`;
    const ev = await camofox(`/tabs/${tabId}/evaluate`, { expression: expr, userId: USER_ID });
    try { return { ok: true, ...JSON.parse(ev.result || '{}') }; }
    catch (e) { return { ok: false, error: '解析失败' }; }
  } finally {
    try { await fetch(`${CAMOFOX_URL}/tabs/${tabId}`, { method: 'DELETE' }); } catch (e) {}
  }
}

// ---------- API ----------
app.get('/api/search', async (req, res) => {
  const kw = String(req.query.kw || '').trim();
  if (!kw) return res.status(400).json({ ok: false, error: '缺少 kw 参数' });

  const cacheKey = 'search_' + Buffer.from(kw).toString('hex').slice(0, 64);
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ ok: true, cached: true, ...cached });

  const r = await qidianSearch(kw);
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error || '起点爬取失败' });
  cacheSet(cacheKey, { books: r.books, count: r.count });
  res.json({ ok: true, cached: false, books: r.books, count: r.count });
});

app.get('/api/detail', async (req, res) => {
  const title = String(req.query.title || '').trim();
  if (!title) return res.status(400).json({ ok: false, error: '缺少 title 参数' });

  const cacheKey = 'detail_' + Buffer.from(title).toString('hex').slice(0, 64);
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ ok: true, cached: true, ...cached });

  const r = await qidianSearch(title);
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error || '起点爬取失败' });
  // 精确匹配
  const target = title;
  const found = (r.books || []).find(b => b.title === target);
  if (!found) return res.json({ ok: false, error: '起点无精确匹配', hint: (r.books || [])[0]?.title || null });

  const result = {
    title: found.title,
    author: found.author,
    category: found.category,
    status: found.status,
    intro: found.intro,
    tags: [found.category].filter(Boolean),
    cover_url: found.cover ? found.cover.replace(/\/150$/, '/300') : '',
    bid: found.bid,
  };
  cacheSet(cacheKey, result);
  res.json({ ok: true, cached: false, ...result });
});

app.get('/api/cache/stats', (req, res) => {
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  res.json({ ok: true, files: files.length });
});

app.get('/health', (req, res) => res.json({ ok: true, name: 'scraper-api' }));

app.listen(PORT, () => console.log(`[scraper-api] listening on :${PORT}`));
