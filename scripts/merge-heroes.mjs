/**
 * Hợp nhất dữ liệu tướng từ Garena (nguồn gốc) và Fandom (bổ sung) -> data/heroes.json
 *
 * Nguyên tắc: Garena là nguồn chuẩn cho tên, hệ tướng, kỹ năng, trang phục.
 * Fandom chỉ điền vào chỗ Garena không có — không bao giờ ghi đè.
 *
 * `role` của Fandom bị bỏ hẳn: viết tắt trên wiki nhập nhằng giữa "đs" (Đấu sĩ)
 * và "ds" (không rõ), trong khi Garena đã cho hệ tướng chuẩn cho cả 129 tướng.
 */
import { readFile } from 'node:fs/promises';
import { noAccent, writeJson } from './lib.mjs';
import { extractTemplate, parseParams, firstArg, allTemplates, cleanWikitext, section, bulletList, paragraphs, textLines } from './wikitext.mjs';

const read = async (p) => JSON.parse(await readFile(p, 'utf8'));

/** Giá trị `lane` trên wiki lẫn lộn tên đầy đủ và viết tắt. */
const LANE = {
  'đi rừng': 'Đi rừng', jgl: 'Đi rừng',
  'hỗ trợ': 'Hỗ trợ', roam: 'Hỗ trợ',
  'đường caesar': 'Đường Tà Thần', top: 'Đường Tà Thần',
  'đường rồng': 'Đường Rồng', ad: 'Đường Rồng',
  'đường giữa': 'Đường giữa', mid: 'Đường giữa',
};

/** Tên template infobox khác nhau giữa các trang EN. */
const EN_INFOBOX = ['HeroInformationBox2', 'HeroInformationBox', 'Hero infobox'];

/** Chỉ số gốc lấy từ infobox EN. Tên trường trên wiki không nhất quán nên gom bí danh. */
const EN_STATS = [
  ['maxhp', 'Máu tối đa', ['maxhp']],
  ['mana', 'Năng lượng', ['maxmana', 'maxenergy']],
  ['attackdamage', 'Công vật lý', ['attackdamage']],
  ['abilitypower', 'Công phép', ['abilitypower']],
  ['armor', 'Giáp', ['armor']],
  ['magicdefense', 'Giáp phép', ['magicdefense']],
  ['attackspeed', 'Tốc đánh', ['attackspeed']],
  ['movementspeed', 'Tốc chạy', ['movementspeed']],
  ['attackrange', 'Tầm đánh', ['attackrange']],
  ['criticalchance', 'Tỷ lệ chí mạng', ['criticalchance']],
  ['criticaldamage', 'Sát thương chí mạng', ['criticaldamage']],
  ['lifesteal', 'Hút máu', ['lifesteal']],
  ['magiclifesteal', 'Hút máu phép', ['magiclifesteal']],
  ['armorpierce', 'Xuyên giáp', ['armorpierce']],
  ['magicpierce', 'Xuyên giáp phép', ['magicpierce']],
  ['cooldownspeed', 'Giảm hồi chiêu', ['cooldownspeed']],
  ['hpregen', 'Hồi máu / 5 giây', ['hp5sec', 'hpper5seconds']],
  ['manaregen', 'Hồi năng lượng / 5 giây', ['mana5sec', 'manaper5seconds', 'regenenergyper5seconds', 'regenenergy5sec']],
];

/** Từ khoá suy ra lối chơi từ mô tả kỹ năng chính thức của Garena. */
const TAG_RULES = [
  ['Khống chế', /choáng|trói|hất tung|đẩy lùi|câm lặng|hoá đá|hóa đá|đóng băng|khống chế|giam|mê hoặc|kéo về|hút vào/i],
  ['Làm chậm', /làm chậm/i],
  ['Dịch chuyển', /lướt|dịch chuyển|nhảy tới|xông tới|dịch bước|bay tới/i],
  ['Hồi máu', /hồi máu|hút máu|hồi phục/i],
  ['Lá chắn', /lá chắn|tấm chắn|khiên/i],
  ['Tàng hình', /tàng hình/i],
  ['Tăng tốc', /tăng tốc/i],
  ['Sát thương chuẩn', /sát thương chuẩn/i],
  ['Miễn khống', /miễn khống|miễn nhiễm/i],
];

const key = (s) => noAccent(s).replace(/\s+/g, '');

/* ------------------------------------------------------------------ Fandom VI */

/** Bảng kỹ năng bản VI: lấy phân loại hiệu ứng theo từng chiêu. */
function parseSkillEffects(wikitext) {
  const skillSection = section(wikitext, 'Kỹ năng');
  const table = skillSection?.match(/\{\|[\s\S]*?\n\|\}/)?.[0];
  if (!table) return {};

  const slotOf = { NT: 'passive', C1: '1', C2: '2', C3: '3' };
  const effects = {};

  for (const row of table.split(/^\|-\s*$/m).slice(1)) {
    const cells = row
      .split(/^\|(?!\})/m)
      .slice(1)
      // Ô có thể mở đầu bằng thuộc tính style: `style="..."|nội dung`.
      .map((c) => c.replace(/^[^|{}\n]*\|/, '').trim());
    if (cells.length < 2) continue;

    const marker = (firstArg(cells[0], 'IconSmall') ?? '').trim().split(/\s+/)[0];
    const slot = slotOf[marker];
    if (!slot) continue;

    effects[slot] = cleanWikitext(cells[1])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return effects;
}

/**
 * Phần "Đề cử": trang bị / phù hiệu / phép bổ trợ + diễn giải.
 *
 * `canon` đưa tên về đúng chính tả của Garena: wiki viết thường ("canh gác") và
 * lệch dấu ("Liệt hỏa" vs "Liệt hoả"), nếu giữ nguyên sẽ không liên kết được
 * sang trang trang bị/phù hiệu tương ứng.
 */
function parseBuild(wikitext, canon) {
  const advice = section(wikitext, 'Đề cử') ?? '';
  const clean = (list, kind) =>
    list.map((s) => canon(cleanWikitext(s), kind)).filter(Boolean);

  return {
    // Một trang có thể đề xuất nhiều bộ trang bị khác nhau.
    itemSets: allTemplates(advice, 'Trang bị').map((t) => clean(t.positional, 'item')).filter((s) => s.length),
    badges: clean(allTemplates(advice, 'Phù hiệu').flatMap((t) => t.positional), 'badge'),
    spells: clean(allTemplates(advice, 'pbt').flatMap((t) => t.positional), 'spell'),
    // Bảng ngọc trên wiki chỉ ghi mã viết tắt ("cvlxg", "10x TLCM") không giải mã
    // chắc chắn được, nên không lấy. Phần diễn giải văn xuôi giữ lại thay thế.
    notes: paragraphs(advice),
  };
}

function parseVi(wikitext, canon) {
  const inner = extractTemplate(wikitext, 'Thông tin tướng');
  const info = inner ? parseParams(inner).named : {};
  const laneRaw = (firstArg(info.lane ?? '', 'Icon Role Lane') ?? '').trim();

  return {
    // Danh hiệu nằm trong <small> ngay sau tên: "Florentino<br><small>Tay kiếm hào hoa</small>".
    title: cleanWikitext((info.name ?? '').match(/<small>([\s\S]*?)<\/small>/)?.[1] ?? '') || null,
    lane: LANE[laneRaw.toLowerCase()] ?? (laneRaw || null),
    faction: cleanWikitext(info.phe ?? '') || null,
    hokName: cleanWikitext(info.namehok ?? '') || null,
    profile: bulletList(section(wikitext, 'Thông tin') ?? ''),
    skillEffects: parseSkillEffects(wikitext),
    build: parseBuild(wikitext, canon),
    trivia: bulletList(section(wikitext, 'Thông tin bên lề') ?? ''),
  };
}

/* ------------------------------------------------------------------ Fandom EN */

function parseEn(wikitext) {
  let inner = null;
  for (const name of EN_INFOBOX) {
    inner = extractTemplate(wikitext, name);
    if (inner) break;
  }
  const box = inner ? parseParams(inner).named : {};
  const lower = Object.fromEntries(Object.entries(box).map(([k, v]) => [k.toLowerCase().trim(), String(v).trim()]));
  const pick = (names) => names.map((n) => lower[n]).find((v) => v) ?? null;

  // Giá trị giữ nguyên văn ("131 / 17.9%") — chỉ làm sạch cú pháp wiki, không diễn giải lại.
  const stats = EN_STATS
    .map(([id, label, aliases]) => ({ id, label, value: cleanWikitext(pick(aliases) ?? '') }))
    .filter((s) => s.value);

  return {
    stats,
    goldCost: cleanWikitext(pick(['goldcost']) ?? '') || null,
    voucherCost: cleanWikitext(pick(['vouchercost']) ?? '') || null,
    lore: paragraphs(section(wikitext, 'Lore') ?? ''),
    balanceHistory: textLines(section(wikitext, 'Balance changes') ?? ''),
  };
}

/* ------------------------------------------------------------------- suy luận */

/** Nhãn lối chơi suy ra từ mô tả kỹ năng — là gợi ý, không phải dữ liệu chính thức. */
function deriveTags(skills) {
  const text = skills.map((s) => s.description).join(' ');
  return TAG_RULES.filter(([, re]) => re.test(text)).map(([tag]) => tag);
}

function deriveDamageType(skills) {
  const text = skills.map((s) => s.description).join(' ');
  const physical = (text.match(/sát thương vật lý/gi) ?? []).length;
  const magic = (text.match(/sát thương phép/gi) ?? []).length;
  if (physical && magic) return physical >= magic * 2 ? 'Vật lý' : magic >= physical * 2 ? 'Phép' : 'Hỗn hợp';
  if (physical) return 'Vật lý';
  if (magic) return 'Phép';
  return null;
}

/* ---------------------------------------------------------------------- main */

async function main() {
  const [heroes, viPages, enPages, aliases, items, badges, spells] = await Promise.all([
    read('data/raw/heroes-garena.json'),
    read('data/raw/fandom-vi.json'),
    read('data/raw/fandom-en.json'),
    read('data/name-aliases.json'),
    read('data/items.json'),
    read('data/badges.json'),
    read('data/spells.json'),
  ]);

  // Từ điển tên chuẩn theo dữ liệu Garena, tra bằng khoá đã bỏ dấu.
  const canonical = {
    item: new Map(items.map((i) => [key(i.name), i.name])),
    badge: new Map(badges.flatMap((b) => b.groups.flatMap((g) => g.skills.map((s) => [key(s.name), s.name])))),
    spell: new Map(spells.map((s) => [key(s.name), s.name])),
  };
  const unknownNames = { item: new Set(), badge: new Set(), spell: new Set() };

  /** Trả tên chuẩn nếu tra được; không thì viết hoa chữ đầu và ghi nhận để rà soát. */
  const canon = (rawName, kind) => {
    if (!rawName) return rawName;
    // Wiki đôi khi dùng viết tắt ("qcbs") — bảng alias mở rộng ra tên đầy đủ trước khi tra.
    const name = aliases.buildNames?.[rawName.toLowerCase()] ?? rawName;
    const found = canonical[kind]?.get(key(name));
    if (found) return found;
    unknownNames[kind]?.add(name);
    return name.replace(/^./, (c) => c.toUpperCase());
  };

  const viByKey = new Map(Object.keys(viPages).map((t) => [key(t), t]));
  const enByKey = new Map(Object.keys(enPages).map((t) => [key(t), t]));

  const unmatchedVi = [];
  const unmatchedEn = [];

  const merged = heroes.map((hero) => {
    // Bảng ánh xạ tay được ưu tiên; còn lại chỉ ghép khi tên trùng khớp tuyệt đối
    // sau khi bỏ dấu. Không dùng so khớp gần đúng — ghép nhầm sẽ gán sai tiểu sử.
    const viTitle = aliases.vi[hero.slug] ?? viByKey.get(key(hero.name));
    const enTitle = aliases.en[hero.slug] ?? enByKey.get(key(hero.name));

    if (!viTitle) unmatchedVi.push(hero.name);
    if (!enTitle) unmatchedEn.push(hero.name);

    const vi = viTitle && viPages[viTitle] ? parseVi(viPages[viTitle], canon) : null;
    const en = enTitle && enPages[enTitle] ? parseEn(enPages[enTitle]) : null;

    return {
      slug: hero.slug,
      name: hero.name,
      title: vi?.title ?? null,
      classes: hero.classes,
      lane: vi?.lane ?? null,
      faction: vi?.faction ?? null,
      portrait: hero.portrait,
      searchKey: hero.searchKey,
      damageType: deriveDamageType(hero.skills),
      // `derived: true` để giao diện gắn nhãn "gợi ý" thay vì trình bày như dữ liệu chính thức.
      tags: deriveTags(hero.skills),
      derived: { tags: true, damageType: true },
      skills: hero.skills.map((skill) => ({ ...skill, effects: vi?.skillEffects?.[skill.slot] ?? [] })),
      skins: hero.skins,
      stats: en?.stats ?? [],
      goldCost: en?.goldCost ?? null,
      voucherCost: en?.voucherCost ?? null,
      profile: vi?.profile ?? [],
      lore: en?.lore ?? [],
      trivia: vi?.trivia ?? [],
      build: vi?.build ?? null,
      balanceHistory: en?.balanceHistory ?? [],
      sources: {
        garena: hero.url,
        fandomVi: viTitle ? `https://arenaofvalor.fandom.com/vi/wiki/${encodeURIComponent(viTitle)}` : null,
        fandomEn: enTitle ? `https://arenaofvalor.fandom.com/wiki/${encodeURIComponent(enTitle)}` : null,
      },
    };
  });

  await writeJson('data/heroes.json', merged);

  const count = (fn) => merged.filter(fn).length;
  console.log('\nĐộ phủ /' + merged.length + ':');
  console.log(`  danh hiệu        : ${count((h) => h.title)}`);
  console.log(`  vị trí (lane)    : ${count((h) => h.lane)}`);
  console.log(`  phe              : ${count((h) => h.faction)}`);
  console.log(`  chỉ số gốc       : ${count((h) => h.stats.length)}`);
  console.log(`  giá vàng         : ${count((h) => h.goldCost)}`);
  console.log(`  giá quân huy     : ${count((h) => h.voucherCost)}`);
  console.log(`  tiểu sử (lore)   : ${count((h) => h.lore.length)}`);
  console.log(`  hồ sơ nhân vật   : ${count((h) => h.profile.length)}`);
  console.log(`  build gợi ý      : ${count((h) => h.build?.itemSets.length)}`);
  console.log(`  hiệu ứng kỹ năng : ${count((h) => h.skills.some((s) => s.effects.length))}`);
  console.log(`  lịch sử cân bằng : ${count((h) => h.balanceHistory.length)}`);
  console.log(`  thông tin bên lề : ${count((h) => h.trivia.length)}`);
  console.log(`  nhãn lối chơi    : ${count((h) => h.tags.length)}`);
  console.log(`  loại sát thương  : ${count((h) => h.damageType)}`);

  console.log(`\nKhông ghép được Fandom VI (${unmatchedVi.length}) — chấp nhận được, wiki VI chỉ có 49 bài.`);
  console.log(`Không ghép được Fandom EN (${unmatchedEn.length}): ${unmatchedEn.join(', ') || '(không có)'}`);

  const leftover = Object.keys(enPages).filter((t) => !merged.some((h) => h.sources.fandomEn?.includes(encodeURIComponent(t))));
  console.log(`Trang EN chưa dùng (${leftover.length}): ${leftover.join(', ') || '(không có)'}`);

  // Duyệt từng chuỗi thay vì soi JSON.stringify: chuỗi JSON của mảng lồng nhau
  // chứa sẵn "[[" nên soi cả khối sẽ báo nhầm.
  const WIKI_SYNTAX = /\{\{|\[\[|<ref|\]\]|'''/;
  const hasWikiSyntax = (value) => {
    if (typeof value === 'string') return WIKI_SYNTAX.test(value);
    if (Array.isArray(value)) return value.some(hasWikiSyntax);
    if (value && typeof value === 'object') return Object.values(value).some(hasWikiSyntax);
    return false;
  };
  const dirty = merged.filter(hasWikiSyntax);
  console.log(`Bản ghi còn cú pháp wiki (${dirty.length}): ${dirty.slice(0, 5).map((h) => h.name).join(', ') || '(không có)'}`);

  // Tên trong build không khớp dữ liệu Garena: có thể là trang bị đã bị gỡ khỏi game
  // hoặc wiki gõ sai. Liệt kê để rà, không tự sửa.
  for (const [kind, names] of Object.entries(unknownNames)) {
    if (names.size) console.log(`Tên ${kind} không khớp dữ liệu Garena (${names.size}): ${[...names].join(', ')}`);
  }
}

main().catch((err) => {
  console.error(`\nLỗi hợp nhất: ${err.message}`);
  process.exit(1);
});
