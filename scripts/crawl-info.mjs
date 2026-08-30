import { readFile, writeFile } from 'node:fs/promises';

/**
 * Sổ ghi các lần crawl, và cách đọc nó.
 *
 * Vì sao cần: `data/raw/` nằm ngoài git, nên kho mã không giữ lại chút dấu vết
 * nào về việc ảnh chụp được lấy khi nào hay có đầy đủ không. Trong khi đó
 * `data/heroes.json` — thứ dựng ra 129 trang tĩnh — lại được commit. Hậu quả là
 * một trường rỗng vì nguồn thật sự không có, và một trường rỗng vì ảnh chụp cũ,
 * nhìn giống hệt nhau. Tệp này là chỗ phân biệt hai trường hợp đó.
 *
 * Chỉ ghi con số đếm được, không ghi phán xét: bước hợp nhất và người đọc tự
 * kết luận từ đó.
 */
export const CRAWL_INFO = 'data/crawl-info.json';

export async function readCrawlInfo(path = CRAWL_INFO) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // Chưa crawl lần nào kể từ khi có tệp này thì coi như không biết gì, chứ
    // không phải là lỗi.
    return {};
  }
}

/** Ghi đè mục của một nguồn, giữ nguyên các nguồn khác. */
export async function recordCrawl(source, entry, path = CRAWL_INFO) {
  const info = await readCrawlInfo(path);
  const next = { ...info, [source]: entry };
  await writeFile(path, `${JSON.stringify(sortKeys(next), null, 2)}\n`, 'utf8');
  return next;
}

const sortKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Số ngày kể từ lần crawl, làm tròn xuống. `null` khi chưa có mốc nào.
 *
 * Nhận `now` từ ngoài để test không phụ thuộc vào đồng hồ máy chạy.
 */
export function ageInDays(entry, now = new Date()) {
  if (!entry?.crawledAt) return null;
  const then = new Date(entry.crawledAt);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((now - then) / 86400000);
}

/**
 * Một dòng mô tả ảnh chụp, dùng cho phần tổng kết của bước hợp nhất.
 *
 * Trước đây bước đó in ra một câu viết cứng ("wiki VI chỉ có 49 bài"), và câu
 * ấy sai ngay khi wiki có thêm bài — đúng kiểu lỗi mà tệp này sinh ra để chặn.
 */
export function describeSnapshot(entry, now = new Date()) {
  if (!entry?.crawledAt) return 'chưa rõ lấy khi nào — chạy `npm run data` để biết';

  const age = ageInDays(entry, now);
  const when = entry.crawledAt.slice(0, 10);
  const size =
    entry.pages != null && entry.titles != null ? `${entry.pages}/${entry.titles} bài, ` : '';

  if (age === 0) return `${size}lấy hôm nay (${when})`;
  return `${size}lấy ${age} ngày trước (${when})`;
}
