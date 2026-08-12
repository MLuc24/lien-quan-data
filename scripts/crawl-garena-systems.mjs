/**
 * Crawl các hệ thống phụ trợ từ trang chính thức Garena:
 * trang bị, ngọc, phép bổ trợ, phù hiệu, chế độ chơi.
 *
 * Toàn bộ dữ liệu nằm sẵn trên trang danh sách nên chỉ cần 1 request mỗi mục
 * (riêng chế độ chơi cần thêm 5 request lấy phần mô tả ở trang chi tiết).
 */
import { get, mapLimit, splitByTag, attr, toText, toParagraphs, toDisplayCase, decode, noAccent, lastSegment, writeJson } from './lib.mjs';

const BASE = 'https://lienquan.garena.vn/hoc-vien';

/** Bảng phân loại giải mã từ `data-type` / `data-level` trên trang danh sách. */
const ITEM_GROUP = { 19: 'Công vật lý', 20: 'Phép thuật', 21: 'Phòng thủ', 22: 'Giày', 23: 'Đi rừng', 24: 'Bảo thạch' };
const ITEM_TIER = { 25: 'Cơ bản', 26: 'Trung cấp', 27: 'Cao cấp' };
const RUNE_COLOR = { 13: 'Đỏ', 14: 'Xanh', 15: 'Tím' };
const RUNE_TIER = { 16: 'I', 17: 'II', 18: 'III' };

/** Số lượng kỳ vọng — lệch quá nhiều nghĩa là Garena đã đổi HTML. */
const EXPECTED = { items: 112, runes: 88, spells: 11, badges: 4, modes: 5 };
const TOLERANCE = 0.2;

const num = (s) => (s == null ? null : Number(s));
const textOf = (body, cls, tag) => toText((body.match(new RegExp(`class="${cls}">([\\s\\S]*?)</${tag}>`)) || [])[1] ?? '');
const imgOf = (body, cls) => (body.match(new RegExp(`class="${cls}"[\\s\\S]*?<img src="([^"]*)"`)) || [])[1] ?? null;
const articleOf = (body) => (body.match(/<article[^>]*>([\s\S]*?)<\/article>/) || [])[1] ?? '';

/**
 * Tách phần mô tả trang bị thành chỉ số cộng thêm và các nội tại.
 *
 * CMS của Garena đánh dấu nội tại không nhất quán: có chỗ mở đầu bằng
 * "Nội tại duy nhất – Tên:", có chỗ lại để ở cuối câu ("… – Nội tại duy nhất"),
 * và có dòng gộp cả chỉ số lẫn nội tại ("+70 Tốc chạy – Nội tại duy nhất: Gia tốc").
 * Vì vậy phải xét theo sự xuất hiện của cụm "Nội tại" ở bất kỳ đâu, rồi mới tách
 * phần chỉ số dính ở đầu dòng ra.
 */
function splitStatsAndPassives(html) {
  const stats = [];
  const passives = [];

  for (const paragraph of toParagraphs(html)) {
    const line = paragraph.replace(/^Thuộc tính:\s*/i, '');
    if (!/nội tại/i.test(line)) {
      stats.push(line);
      continue;
    }

    const split = line.match(/^(.*?)\s+[–—-]\s+(Nội tại.*)$/i);
    // Chỉ tách khi phần đầu đúng là danh sách chỉ số: bắt đầu bằng +/số và không
    // có dấu hai chấm (dấu hiệu của một câu mô tả nội tại chứ không phải chỉ số).
    if (split && /^[+\-\d][^:]*$/.test(split[1].trim())) {
      stats.push(split[1].trim());
      passives.push(split[2].trim());
    } else {
      passives.push(line);
    }
  }

  return { stats, passives };
}

/* ------------------------------------------------------------------ trang bị */

function parseItems(html) {
  return splitByTag(html, 'st-items__item').map(({ attrs, body }) => {
    const name = textOf(body, 'st-items__item--name', 'h2');
    const goldRaw = (body.match(/icon-gold[^>]*>\s*([\d.,]+)/) || [])[1] ?? null;
    const { stats, passives } = splitStatsAndPassives(articleOf(body));
    const group = ITEM_GROUP[num(attr(attrs, 'data-type'))] ?? null;

    return {
      slug: noAccent(name).replace(/\s+/g, '-'),
      name,
      icon: imgOf(body, 'st-items__item--img'),
      group,
      tier: ITEM_TIER[num(attr(attrs, 'data-level'))] ?? null,
      // Cho phép null: vài trang bị đặc biệt không niêm yết giá.
      gold: goldRaw ? Number(goldRaw.replace(/[.,]/g, '')) : null,
      stats,
      passives,
      searchKey: noAccent(name),
    };
  });
}

/* ---------------------------------------------------------------------- ngọc */

/**
 * Tên ngọc trong CMS không nhất quán: nhóm Đỏ bậc I viết HOA toàn bộ
 * ("ĐỎ I TỐC ĐÁNH/TỶ LỆ CHÍ MẠNG"), các nhóm khác viết thường.
 * Dựng lại tên hiển thị từ màu/cấp đã biết + phần chỉ số chuẩn hoá.
 */
function normalizeRuneName(rawName, color, tier) {
  const stat = toDisplayCase(rawName.replace(/^(đỏ|xanh|tím)\s+(i{1,3})\s+/i, ''));
  return [color, tier, stat].filter(Boolean).join(' ');
}

function parseRunes(html) {
  return splitByTag(html, 'st-runes__item').map(({ attrs, body }) => {
    const rawName = textOf(body, 'st-runes__item--name', 'h2');
    const color = RUNE_COLOR[num(attr(attrs, 'data-type'))] ?? null;
    const tier = RUNE_TIER[num(attr(attrs, 'data-level'))] ?? null;
    const name = normalizeRuneName(rawName, color, tier);

    return {
      slug: noAccent(name).replace(/\s+/g, '-'),
      name,
      rawName,
      icon: imgOf(body, 'st-runes__item--img'),
      color,
      tier,
      stats: toParagraphs(articleOf(body)),
      searchKey: noAccent(name),
    };
  });
}

/* -------------------------------------------------------------- phép bổ trợ */

function parseSpells(html) {
  return splitByTag(html, 'st-extra-skills__item').map(({ attrs, body }) => {
    // Tên trong CMS viết hoa toàn bộ ("TỐC BIẾN") -> đưa về dạng hiển thị thường.
    const name = toDisplayCase(textOf(body, 'st-extra-skills__item--name', 'h3'));
    // toText() lọc luôn khối markup rác bị dán nhầm vào CMS ở trang này.
    const description = textOf(body, 'st-extra-skills__item--content', 'div');

    return {
      slug: noAccent(name).replace(/\s+/g, '-'),
      name,
      icon: imgOf(body, 'st-extra-skills__item--img'),
      description,
      // Một số phép chỉ tồn tại trong mùa hiện tại, cần phân biệt với phép cố định.
      seasonal: /cơ chế mùa|chỉ xuất hiện trong s\d/i.test(description),
      searchKey: noAccent(name),
    };
  });
}

/* ------------------------------------------------------------------ phù hiệu */

function parseBadges(html) {
  // Mô tả từng kỹ năng nằm ở các khối riêng, khớp với nút bấm qua id "badgeID-groupN-skillM".
  const skillDetails = new Map();
  for (const { attrs, body } of splitByTag(html, 'st-badges__skill')) {
    const id = attr(attrs, 'id');
    if (!id) continue;
    skillDetails.set(id, {
      kind: toText((body.match(/--head"[\s\S]*?<h3>([\s\S]*?)<\/h3>/) || [])[1] ?? ''),
      title: textOf(body, 'st-badges__skill--title', 'h4'),
      description: textOf(body, 'st-badges__skill--content', 'article'),
    });
  }

  return splitByTag(html, 'st-badges__item').map(({ attrs, body }) => {
    const id = attr(attrs, 'id');
    const name = textOf(body, 'st-badges__item--name', 'h2');
    const content = toParagraphs((body.match(/class="st-badges__item--content">([\s\S]*?)<\/div>/) || [])[1] ?? '');
    const style = attr(attrs, 'style') ?? '';

    const skillList = (body.match(/class="st-badges__item--skills">([\s\S]*?)<\/ul>/) || [])[1] ?? '';
    const groups = [...skillList.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li, gi) => ({
      index: gi + 1,
      skills: [...li[1].matchAll(/href="#([^"]+)"[\s\S]*?<img src="([^"]*)"\s*>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => ({
        id: m[1],
        icon: m[2],
        name: decode(m[3]).trim(),
        ...(skillDetails.get(m[1]) ?? { kind: null, title: null, description: '' }),
      })),
    }));

    return {
      id,
      slug: noAccent(name).replace(/\s+/g, '-'),
      name,
      // Dòng đầu luôn có dạng "Thích hợp: <dạng tướng>"; các dòng sau là mô tả.
      suitableFor: (content.find((p) => /^Thích hợp:/i.test(p)) ?? '').replace(/^Thích hợp:\s*/i, '') || null,
      description: content.filter((p) => !/^Thích hợp:/i.test(p)).join(' '),
      color: (style.match(/--badge-color:\s*([^;]+)/) || [])[1]?.trim() ?? null,
      background: (style.match(/--badge-background-pc:\s*url\(([^)]+)\)/) || [])[1]?.trim() ?? null,
      backgroundMobile: (style.match(/--badge-background-mo:\s*url\(([^)]+)\)/) || [])[1]?.trim() ?? null,
      groups,
      searchKey: noAccent(name),
    };
  });
}

/* -------------------------------------------------------------- chế độ chơi */

async function parseModes(html) {
  const index = splitByTag(html, 'st-game-modes__item').map(({ attrs, body }) => {
    const name = textOf(body, 'st-game-modes__item--name', 'h3');
    const url = attr(attrs, 'href');
    return {
      slug: url ? lastSegment(url) : noAccent(name).replace(/\s+/g, '-'),
      name,
      url,
      image: imgOf(body, 'st-game-modes__item--img'),
      searchKey: noAccent(name),
    };
  });

  return mapLimit(index, 3, async (mode) => {
    if (!mode.url) return { ...mode, description: [] };
    const detail = await get(mode.url);
    const article = (detail.match(/class="game-mode article">([\s\S]*?)<\/div>/) || [])[1] ?? '';
    return { ...mode, description: toParagraphs(article) };
  });
}

/* ---------------------------------------------------------------------- main */

function check(label, actual) {
  const expected = EXPECTED[label];
  const drift = Math.abs(actual - expected) / expected;
  if (drift > TOLERANCE) {
    throw new Error(
      `${label}: đọc được ${actual}, kỳ vọng khoảng ${expected} (lệch ${Math.round(drift * 100)}%). ` +
        'Nhiều khả năng Garena đã đổi cấu trúc HTML — kiểm tra lại selector.'
    );
  }
  console.log(`  ${label.padEnd(7)} : ${actual}`);
}

async function main() {
  console.log('Tải các trang Học viện...');
  const [itemsHtml, runesHtml, spellsHtml, badgesHtml, modesHtml] = await Promise.all([
    get(`${BASE}/trang-bi/`),
    get(`${BASE}/bang-ngoc/`),
    get(`${BASE}/phu-tro/`),
    get(`${BASE}/phu-hieu/`),
    get(`${BASE}/che-do-choi/`),
  ]);

  const items = parseItems(itemsHtml);
  const runes = parseRunes(runesHtml);
  const spells = parseSpells(spellsHtml);
  const badges = parseBadges(badgesHtml);
  const modes = await parseModes(modesHtml);

  console.log('\nSố lượng:');
  check('items', items.length);
  check('runes', runes.length);
  check('spells', spells.length);
  check('badges', badges.length);
  check('modes', modes.length);

  await writeJson('data/items.json', items);
  await writeJson('data/runes.json', runes);
  await writeJson('data/spells.json', spells);
  await writeJson('data/badges.json', badges);
  await writeJson('data/modes.json', modes);

  console.log('\nKiểm tra chất lượng:');
  console.log(`  trang bị không có giá : ${items.filter((i) => i.gold == null).length}`);
  console.log(`  trang bị thiếu nhóm   : ${items.filter((i) => !i.group).length}`);
  // Vài viên ngọc có <article> rỗng ngay trong nguồn Garena — thiếu sót dữ liệu gốc,
  // không phải lỗi parser. Liệt kê ra để người bảo trì biết, không tự bịa số liệu.
  const runesNoStats = runes.filter((r) => r.stats.length === 0);
  console.log(`  ngọc rỗng ở nguồn     : ${runesNoStats.length}${runesNoStats.length ? ' → ' + runesNoStats.map((r) => r.name).join(', ') : ''}`);
  console.log(`  phép theo mùa         : ${spells.filter((s) => s.seasonal).map((s) => s.name).join(', ') || '(không có)'}`);
  console.log(`  tổng kỹ năng phù hiệu : ${badges.reduce((n, b) => n + b.groups.reduce((m, g) => m + g.skills.length, 0), 0)}`);
  console.log(`  chế độ thiếu mô tả    : ${modes.filter((m) => m.description.length === 0).length}`);

  const dirty = [...items, ...runes, ...spells, ...modes].filter((x) =>
    /data-testid|text-token|<[a-z]+[\s>]/.test(JSON.stringify(x))
  );
  console.log(`  bản ghi còn rác HTML  : ${dirty.length}${dirty.length ? ' → ' + dirty.slice(0, 3).map((d) => d.name).join(', ') : ''}`);
}

main().catch((err) => {
  console.error(`\nLỗi crawl hệ thống: ${err.message}`);
  process.exit(1);
});
