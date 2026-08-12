# lien-quan-data

Open, machine-readable data for **Arena of Valor / Liên Quân Mobile** — heroes, items, arcana (runes), summoner spells, badges and game modes, as plain JSON. No API key, no rate limit, no scraping on your side.

Rebuilt weekly from the official Garena site and the Arena of Valor Fandom wiki by the crawlers in this repo.

| File | Records | Contents |
|---|---:|---|
| [`data/heroes.json`](data/heroes.json) | 129 | stats, skills, skins, prices, lore, suggested builds, balance history |
| [`data/items.json`](data/items.json) | 112 | price, stats, passives |
| [`data/runes.json`](data/runes.json) | 88 | tier, effects |
| [`data/spells.json`](data/spells.json) | 11 | cooldown, unlock level, effects |
| [`data/badges.json`](data/badges.json) | 4 | badge system |
| [`data/modes.json`](data/modes.json) | 5 | game modes |
| [`data/name-aliases.json`](data/name-aliases.json) | — | VI ↔ EN hero name mapping |

## Use it

No install needed — fetch straight from the CDN:

```js
const heroes = await fetch(
  'https://cdn.jsdelivr.net/gh/MLuc24/lien-quan-data@main/data/heroes.json'
).then((r) => r.json());

const airi = heroes.find((h) => h.slug === 'airi');
console.log(airi.skills.map((s) => `${s.slotLabel}: ${s.name}`));
// Nội tại: Sắc Lẻm, Chiêu 1: Phi Tiêu, Chiêu 2: Kiếm Vũ, Chiêu 3: Long Kiếm
```

Pin to a commit instead of `@main` if you need a stable snapshot.

## Hero record

```jsonc
{
  "slug": "airi",
  "name": "Airi",
  "title": "Ninja rồng",
  "classes": ["Sát thủ"],
  "lane": "Đường Tà Thần",
  "damageType": "Vật lý",
  "tags": ["Khống chế", "Làm chậm", "Dịch chuyển", "Lá chắn", "Tăng tốc"],
  "goldCost": 18888,
  "voucherCost": 1199,
  "stats":  [{ "id": "maxhp", "label": "Máu tối đa", "value": "3543" }],
  "skills": [{ "slot": "passive", "slotLabel": "Nội tại", "name": "Sắc Lẻm",
              "description": "...", "icon": "https://...", "effects": ["Chuẩn", "Làm chậm"] }],
  "skins":  [{ "index": 1, "name": "Airi", "shortName": "Mặc định",
              "thumb": "https://...", "splash": "https://...", "rarityIcon": null }],
  "build":  { "itemSets": [["Giày kiên cường", "Nanh Fenrir", "..."]],
              "badges": ["Dư ảnh", "Cường công"], "spells": [], "notes": ["..."] },
  "profile": ["Sinh nhật: 12-02", "Chiều cao: 165cm", "Nơi sinh: Đảo Sương mù"],
  "lore": "...",
  "trivia": ["..."],
  "balanceHistory": ["21st January 2021, update Beta 29.", "AIRI: REVAMP", "..."],
  "sources": { "garena": "https://...", "fandomVi": "https://...", "fandomEn": "https://..." }
}
```

Every record carries a `sources` object, so any value can be traced back to the page it came from. Text is Vietnamese — that is the language the sources publish in.

## Rebuild it yourself

Requires Node.js 18+. No dependencies.

```bash
npm run data     # crawl everything, then merge
npm run merge    # re-merge from data/raw without re-crawling
```

Individual steps: `crawl:heroes` (Garena hero pages), `crawl:systems` (items/runes/spells/badges/modes), `crawl:fandom` (wiki text via the MediaWiki API), `merge` (join sources into `data/*.json`).

The merge step prints a coverage report — how many heroes got lore, builds, balance history, and which pages failed to match — so a bad crawl is visible instead of silent.

## Data sources and licensing

- **Code** in this repo: [MIT](LICENSE).
- **Game data** (names, stats, images, skill text) belongs to **Garena / TiMi Studios**. This repo is an unofficial, non-commercial reference and is not affiliated with or endorsed by them.
- **Wiki-derived text** (lore, trivia, balance history) comes from the [Arena of Valor Fandom wiki](https://arenaofvalor.fandom.com) and is licensed **[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)**. If you redistribute that text, keep the attribution and the share-alike terms.
- Image URLs point at the original hosts; nothing is rehosted here.

## Contributing

Data wrong or out of date? Open an issue with the hero/item and the source URL. Parser fixes are welcome — the crawlers are small, dependency-free ESM scripts under [`scripts/`](scripts/).

---

## Tiếng Việt

Dữ liệu mở dạng JSON cho **Liên Quân Mobile**: 129 tướng, 112 trang bị, 88 ngọc, 11 phép bổ trợ, huy hiệu và chế độ chơi. Không cần API key, dùng trực tiếp qua CDN (xem ví dụ ở trên).

Dữ liệu được crawl lại hằng tuần từ trang chính thức của Garena và wiki Fandom. Mỗi bản ghi có trường `sources` trỏ về đúng trang gốc để đối chiếu.

Đây là dự án tham khảo phi thương mại, không liên kết với Garena. Dữ liệu game thuộc về Garena/TiMi; phần nội dung lấy từ Fandom theo giấy phép CC BY-SA 3.0.
