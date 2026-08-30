/**
 * Tải wikitext các trang tướng từ Fandom (bản tiếng Việt và tiếng Anh).
 *
 * Trang HTML của Fandom bị Cloudflare chặn, nhưng MediaWiki API vẫn mở.
 * Đây là cách duy nhất lấy được dữ liệu ở đây.
 *
 * Fandom phát hành nội dung theo giấy phép CC-BY-SA — phải ghi nguồn trên web.
 */
import { writeJson } from './lib.mjs';

const WIKIS = {
  vi: { api: 'https://arenaofvalor.fandom.com/vi/api.php', listPage: 'Bản mẫu:AllHeroes', out: 'data/raw/fandom-vi.json' },
  en: { api: 'https://arenaofvalor.fandom.com/api.php', listCategory: 'Category:Heroes', out: 'data/raw/fandom-en.json' },
};

// Header HTTP chỉ nhận ASCII — không đặt tiếng Việt có dấu ở đây.
const HEADERS = { 'User-Agent': 'lien-quan-wiki/1.0 (non-commercial reference project)' };
const BATCH_SIZE = 50; // giới hạn của MediaWiki cho client thường

async function api(endpoint, params) {
  const url = `${endpoint}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} khi gọi ${endpoint}`);
  const data = await res.json();
  if (data.error) throw new Error(`API lỗi: ${data.error.code} — ${data.error.info ?? ''}`);
  return data;
}

/** Danh sách tướng bản VI lấy từ template AllHeroes (đầy đủ hơn thể loại). */
async function titlesFromTemplate(endpoint, page) {
  const data = await api(endpoint, { action: 'parse', page, prop: 'links' });
  return data.parse.links.filter((l) => l.ns === 0).map((l) => l.title);
}

/** Danh sách tướng bản EN lấy từ thể loại, có phân trang. */
async function titlesFromCategory(endpoint, category) {
  const all = [];
  let cont = null;
  do {
    const data = await api(endpoint, {
      action: 'query',
      list: 'categorymembers',
      cmtitle: category,
      cmlimit: '500',
      ...(cont ? { cmcontinue: cont } : {}),
    });
    all.push(...data.query.categorymembers.map((m) => m.title));
    cont = data.continue?.cmcontinue ?? null;
  } while (cont);
  return all;
}

/** Tải wikitext hàng loạt. Trang không tồn tại trả về null. */
async function fetchWikitext(endpoint, titles) {
  const result = {};
  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    const data = await api(endpoint, {
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: batch.join('|'),
    });
    for (const page of data.query.pages) {
      result[page.title] = page.missing ? null : page.revisions?.[0]?.slots?.main?.content ?? null;
    }
    process.stdout.write(`\r  đã tải ${Math.min(i + BATCH_SIZE, titles.length)}/${titles.length}`);
  }
  process.stdout.write('\n');
  return result;
}

async function main() {
  for (const [lang, cfg] of Object.entries(WIKIS)) {
    console.log(`\nFandom ${lang.toUpperCase()}:`);
    const titles = cfg.listPage
      ? await titlesFromTemplate(cfg.api, cfg.listPage)
      : await titlesFromCategory(cfg.api, cfg.listCategory);
    console.log(`  ${titles.length} tiêu đề tướng`);

    const pages = await fetchWikitext(cfg.api, titles);
    const present = Object.entries(pages).filter(([, w]) => w != null);
    console.log(`  có nội dung: ${present.length}/${titles.length}`);

    await writeJson(cfg.out, Object.fromEntries(present));
  }
}

main().catch((err) => {
  console.error(`\nLỗi crawl Fandom: ${err.message}`);
  process.exit(1);
});
