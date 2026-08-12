/**
 * Crawl dữ liệu tướng từ trang chính thức Garena.
 *
 * Nguồn:
 *   - Danh sách: https://lienquan.garena.vn/hoc-vien/tuong-skin/
 *   - Chi tiết:  .../hoc-vien/tuong-skin/d/<slug>/
 *
 * Trang chi tiết chỉ có kỹ năng và trang phục. Danh hiệu, lore, build gợi ý
 * được bổ sung từ Fandom ở bước sau (scripts/crawl-fandom.mjs).
 */
import { get, mapLimit, findElements, attr, toText, decode, noAccent, lastSegment, writeJson } from './lib.mjs';

const LIST_URL = 'https://lienquan.garena.vn/hoc-vien/tuong-skin/';
const OUT = 'data/raw/heroes-garena.json';

/** id nhóm trong `data-type` của trang danh sách -> tên hệ tướng. */
const HERO_CLASS = {
  28: 'Đấu sĩ',
  29: 'Pháp sư',
  30: 'Trợ thủ',
  31: 'Đỡ đòn',
  32: 'Sát thủ',
  33: 'Xạ thủ',
};

/** heroSkill-1 là nội tại, 2..4 là chiêu 1..3. */
const SKILL_SLOTS = [
  { slot: 'passive', label: 'Nội tại' },
  { slot: '1', label: 'Chiêu 1' },
  { slot: '2', label: 'Chiêu 2' },
  { slot: '3', label: 'Chiêu 3' },
];

/** Dừng hẳn nếu số tướng tụt bất thường — dấu hiệu Garena đổi HTML. */
const MIN_EXPECTED_HEROES = 100;

/** Đọc trang danh sách -> chỉ mục tướng (tên, ảnh, hệ, link chi tiết). */
function parseHeroIndex(html) {
  return findElements(html, 'st-heroes__item', 'a').map(({ attrs, body }) => {
    const url = attr(attrs, 'href');
    const name = decode((body.match(/__item--name">([\s\S]*?)<\/h2>/) || [])[1] ?? '').trim();
    const portrait = (body.match(/__item--img">[\s\S]*?<img src="([^"]*)"/) || [])[1] ?? null;
    const classIds = [...(attr(attrs, 'data-type') ?? '').matchAll(/\d+/g)].map((m) => Number(m[0]));

    return {
      // Slug lấy từ URL chứ không sinh từ tên: có hai tướng cùng tên "Flowborn"
      // (hai dạng Pháp sư / Xạ thủ) nên sinh từ tên sẽ đè mất một bản ghi.
      slug: url ? lastSegment(url) : null,
      name,
      url,
      portrait,
      classes: classIds.map((id) => HERO_CLASS[id]).filter(Boolean),
      searchKey: noAccent(name),
    };
  });
}

/** Đọc trang chi tiết -> 4 kỹ năng kèm icon. */
function parseSkills(html) {
  const icons = [...html.matchAll(/<a href="#heroSkill-\d+"[^>]*>\s*<img src="([^"]*)"/g)].map((m) => m[1]);

  return [...html.matchAll(
    /<div class="hero__skills--detail[^"]*" id="heroSkill-(\d+)">\s*<h3>([\s\S]*?)<\/h3>\s*<article>([\s\S]*?)<\/article>/g
  )].map((m) => {
    const index = Number(m[1]) - 1;
    const { slot, label } = SKILL_SLOTS[index] ?? { slot: String(index), label: `Kỹ năng ${index}` };
    return {
      slot,
      slotLabel: label,
      name: toText(m[2]),
      description: toText(m[3]),
      icon: icons[index] ?? null,
    };
  });
}

/** Đọc trang chi tiết -> danh sách trang phục kèm splash art. */
function parseSkins(html, heroName) {
  const thumbs = [...html.matchAll(/<a href="#heroSkin-\d+"[^>]*>\s*<img src="([^"]*)"/g)].map((m) => m[1]);

  return [...html.matchAll(
    /<div class="hero__skins--detail[^"]*" id="heroSkin-(\d+)">\s*<h3>([\s\S]*?)<\/h3>\s*<picture><img src="([^"]*)"/g
  )].map((m, i) => {
    const heading = m[2];
    // Nhãn độ hiếm là một <img> nằm ngay trong <h3>, trước phần tên.
    const rarityIcon = (heading.match(/<img src="([^"]*)"/) || [])[1] ?? null;
    const fullName = toText(heading);
    // Tên hiển thị bỏ tiền tố tên tướng: "Florentino Vũ kiếm sư" -> "Vũ kiếm sư".
    const shortName = fullName.startsWith(heroName)
      ? fullName.slice(heroName.length).trim() || 'Mặc định'
      : fullName;

    return {
      index: Number(m[1]),
      name: fullName,
      shortName,
      rarityIcon,
      thumb: thumbs[i] ?? null,
      splash: m[3],
    };
  });
}

async function main() {
  console.log(`Tải danh sách tướng: ${LIST_URL}`);
  const index = parseHeroIndex(await get(LIST_URL));

  if (index.length < MIN_EXPECTED_HEROES) {
    throw new Error(
      `Chỉ đọc được ${index.length} tướng (kỳ vọng >= ${MIN_EXPECTED_HEROES}). ` +
        'Nhiều khả năng Garena đã đổi cấu trúc HTML — kiểm tra lại selector "st-heroes__item".'
    );
  }
  console.log(`  → ${index.length} tướng trong danh sách`);

  console.log('Tải trang chi tiết từng tướng...');
  const heroes = await mapLimit(index, 6, async (hero) => {
    const html = await get(hero.url);
    return { ...hero, skills: parseSkills(html), skins: parseSkins(html, hero.name) };
  });

  heroes.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  await writeJson(OUT, heroes);

  const noSkills = heroes.filter((h) => h.skills.length === 0);
  const partialSkills = heroes.filter((h) => h.skills.length > 0 && h.skills.length < 4);
  const noIcon = heroes.filter((h) => h.skills.some((s) => !s.icon));
  const noClass = heroes.filter((h) => h.classes.length === 0);

  console.log('\nThống kê:');
  console.log(`  tướng            : ${heroes.length}`);
  console.log(`  tổng kỹ năng     : ${heroes.reduce((n, h) => n + h.skills.length, 0)}`);
  console.log(`  tổng trang phục  : ${heroes.reduce((n, h) => n + h.skins.length, 0)}`);
  console.log(`  thiếu kỹ năng    : ${noSkills.length}${noSkills.length ? ' → ' + noSkills.map((h) => h.name).join(', ') : ''}`);
  console.log(`  chưa đủ 4 chiêu  : ${partialSkills.length}${partialSkills.length ? ' → ' + partialSkills.map((h) => h.name).join(', ') : ''}`);
  console.log(`  thiếu icon chiêu : ${noIcon.length}${noIcon.length ? ' → ' + noIcon.map((h) => h.name).join(', ') : ''}`);
  console.log(`  thiếu hệ tướng   : ${noClass.length}${noClass.length ? ' → ' + noClass.map((h) => h.name).join(', ') : ''}`);

  const dupNames = Object.entries(
    heroes.reduce((acc, h) => ({ ...acc, [h.name]: (acc[h.name] ?? 0) + 1 }), {})
  ).filter(([, n]) => n > 1);
  if (dupNames.length) {
    console.log(`  trùng tên        : ${dupNames.map(([n, c]) => `${n} ×${c}`).join(', ')} (phân biệt bằng slug)`);
  }
}

main().catch((err) => {
  console.error(`\nLỗi crawl tướng: ${err.message}`);
  process.exit(1);
});
