// Tiện ích dùng chung cho các script crawl.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** Tải một URL, tự thử lại khi lỗi mạng. */
export async function get(url, { retries = 3, headers = {} } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (i === retries) throw new Error(`Không tải được ${url}: ${err.message}`);
      await sleep(500 * (i + 1));
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chạy song song có giới hạn để không dội quá nhiều request cùng lúc. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&nbsp;': ' ', '&#8211;': '–', '&#8212;': '—', '&#8216;': '‘',
  '&#8217;': '’', '&#8220;': '“', '&#8221;': '”',
  '&#8230;': '…', '&#039;': "'", '&#39;': "'",
};

/** Giải mã HTML entity. */
export function decode(s = '') {
  return s
    .replace(/&#(\d+);/g, (m, code) => ENTITIES[m] ?? String.fromCharCode(+code))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? m);
}

/**
 * Bỏ thẻ HTML, giữ xuống dòng theo <br> và </p>.
 * Đồng thời loại bỏ rác markup bị dán nhầm vào CMS của Garena
 * (một số trang có nguyên khối HTML copy từ ChatGPT lẫn vào nội dung).
 */
export function toText(html = '') {
  return decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*data-testid="[^"]*"[^>]*>[\s\S]*?<\/[a-z]+>/gi, '')
      .replace(/<[^>]*class="[^"]*text-token-text-primary[^"]*"[^>]*>[\s\S]*?<\/[a-z]+>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Tách nội dung thành các đoạn văn. */
export const toParagraphs = (html) => toText(html).split('\n').map((s) => s.trim()).filter(Boolean);

/**
 * Đưa chuỗi VIẾT HOA TOÀN BỘ về dạng hiển thị thường.
 * CMS của Garena nhập tên không nhất quán: tên phép bổ trợ và ngọc bậc I nhóm Đỏ
 * viết hoa hết, phần còn lại viết thường. Chuỗi đã có chữ thường thì giữ nguyên.
 */
export function toDisplayCase(s = '') {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split('/')
    .map((part) => part.replace(/^(\s*)(\S)/, (_, space, char) => space + char.toUpperCase()))
    .join('/');
}

/** Bỏ dấu tiếng Việt -> phục vụ tìm kiếm ("Tel'Annas" -> "telannas"). */
export function noAccent(s = '') {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Tạo slug an toàn cho URL. */
export const slugify = (s = '') => noAccent(s).replace(/\s+/g, '-');

/** Lấy slug cuối cùng của một URL. */
export const lastSegment = (url = '') => url.split('/').filter(Boolean).pop();

/**
 * Tìm mọi phần tử có class chỉ định, trả về `{ attrs, body }`.
 *
 * Không cắt chuỗi theo `class="..."` vì thứ tự thuộc tính trong HTML của Garena
 * không cố định — thẻ `<a class="st-heroes__item">` đặt `href` TRƯỚC `class`, nên
 * cắt theo class sẽ đẩy `href` sang khối trước và lấy nhầm link kế tiếp.
 */
export function findElements(html, className, tag = '[a-z]+') {
  const re = new RegExp(`<(${tag})\\b([^>]*class="${className}"[^>]*)>([\\s\\S]*?)<\\/\\1>`, 'g');
  return [...html.matchAll(re)].map((m) => ({ attrs: m[2], body: m[3] }));
}

/**
 * Cắt HTML thành từng khối theo thẻ mở có class chỉ định.
 *
 * Dùng cho các item là `<div>` có thẻ con lồng nhau (trang bị, ngọc, phù hiệu):
 * `findElements` khớp thẻ đóng đầu tiên nên sẽ cắt cụt ngay ở `<div>` con.
 * Ở đây mỗi khối chạy từ hết thẻ mở tới thẻ mở của item kế tiếp, nên bao trọn
 * phần thân bất kể lồng bao nhiêu cấp.
 */
export function splitByTag(html, className) {
  const marks = [...html.matchAll(new RegExp(`<[a-z]+\\b[^>]*class="${className}"[^>]*>`, 'g'))];
  return marks.map((m, i) => ({
    attrs: m[0],
    body: html.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined),
  }));
}

export const attr = (chunk, name) => (chunk.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] ?? null;

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  const kb = (Buffer.byteLength(JSON.stringify(data)) / 1024).toFixed(0);
  console.log(`  → ${path} (${kb} KB)`);
}
