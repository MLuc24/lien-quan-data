/**
 * Bộ đọc wikitext MediaWiki cho dữ liệu Fandom.
 *
 * Không dùng regex đơn lẻ để lấy template: các template ở đây lồng nhau
 * ({{Thông tin tướng|lane={{Icon Role Lane|top}}}}), regex sẽ dừng ở `}}` đầu tiên
 * và cắt mất phần lớn tham số. Ở đây quét theo cặp ngoặc cân bằng.
 */

/**
 * Mọi lần xuất hiện của template `{{name...}}`, trả về phần bên trong đã cân
 * bằng ngoặc, theo thứ tự trong trang.
 *
 * Phải duyệt hết chứ không dừng ở lần đầu: trang Tulen mở `{{Hero infobox` hai
 * lần vì có người dán một câu trích vào giữa tên template và tham số rồi mở lại
 * template. Lần mở đầu không bao giờ đóng, nên đếm ngoặc chạy tới hết trang mà
 * không về 0; toàn bộ chỉ số và giá của tướng đó biến mất. Lần mở thứ hai lại
 * hoàn toàn hợp lệ.
 */
export function extractTemplates(text, name) {
  const found = [];
  const opening = `{{${name}`;

  for (let start = text.indexOf(opening); start !== -1; start = text.indexOf(opening, start + 2)) {
    let depth = 0;
    for (let i = start; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') {
        depth++;
        i++;
        continue;
      }
      if (text[i] === '}' && text[i + 1] === '}') {
        depth--;
        if (depth === 0) {
          found.push(text.slice(start + 2 + name.length, i));
          break;
        }
        i++;
      }
    }
  }

  return found;
}

/** Lần xuất hiện cân bằng ngoặc đầu tiên của template `{{name...}}`. */
export function extractTemplate(text, name) {
  return extractTemplates(text, name)[0] ?? null;
}

/** Tách tham số template theo dấu `|` ở cấp ngoài cùng (bỏ qua `|` nằm trong {{}} hoặc [[]]). */
export function parseParams(inner = '') {
  const parts = [];
  let buf = '';
  let brace = 0;
  let bracket = 0;

  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '{{') { brace++; buf += two; i++; continue; }
    if (two === '}}') { brace--; buf += two; i++; continue; }
    if (two === '[[') { bracket++; buf += two; i++; continue; }
    if (two === ']]') { bracket--; buf += two; i++; continue; }
    if (inner[i] === '|' && brace === 0 && bracket === 0) { parts.push(buf); buf = ''; continue; }
    buf += inner[i];
  }
  parts.push(buf);

  const named = {};
  const positional = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    // Chỉ coi là tham số có tên khi dấu `=` đứng trước mọi ngoặc mở.
    if (eq > 0 && !/[{[]/.test(part.slice(0, eq))) {
      named[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    } else if (part.trim()) {
      positional.push(part.trim());
    }
  }
  return { named, positional };
}

/** Lấy tham số vị trí đầu tiên của một template lồng, vd `{{Icon Role Lane|top}}` -> `top`. */
export function firstArg(value = '', templateName) {
  const inner = extractTemplate(value, templateName);
  if (inner == null) return null;
  return parseParams(inner).positional[0] ?? null;
}

/** Danh sách tham số vị trí của một template, vd `{{Trang bị|A|B|C}}` -> [A, B, C]. */
export function templateArgs(text = '', templateName) {
  const inner = extractTemplate(text, templateName);
  if (inner == null) return [];
  return parseParams(inner).positional.filter(Boolean);
}

/**
 * Mọi lần xuất hiện của một template, không chỉ lần đầu.
 * Cần cho phần build: một trang có thể liệt kê nhiều bộ trang bị khác nhau.
 */
export function allTemplates(text = '', templateName) {
  const found = [];
  let rest = text;
  let guard = 0;
  while (guard++ < 50) {
    const inner = extractTemplate(rest, templateName);
    if (inner == null) break;
    found.push(parseParams(inner));
    const at = rest.indexOf(`{{${templateName}`);
    rest = rest.slice(at + 2 + templateName.length + inner.length);
  }
  return found;
}

/**
 * Chuyển wikitext thành văn bản thuần.
 *
 * Các template chỉ để tô màu/gắn icon ({{colors|…}}, {{buff|…}}, {{IconDesc|icon|chữ}})
 * được thay bằng phần chữ bên trong thay vì xoá, nếu không sẽ mất nội dung.
 */
/**
 * Không gian tên của MediaWiki: liên kết tới thể loại, tệp hay trang trang phục
 * là dữ liệu quản trị của wiki, không phải câu chữ để đọc.
 */
const NAMESPACES = 'Category|Thể loại|File|Tập tin|Image|Hình|Media|Skin';

/**
 * Chữ bị giải mã sai, sửa lại về ký tự đúng.
 *
 * Nguồn có những đoạn từng bị đọc bằng bảng mã một byte rồi lưu lại thành UTF-8,
 * nên một dấu gạch dài hoá thành ba ký tự lạ. Tiểu sử của Dirak trên site đang
 * hiện "absorbâ€"even" vì vậy. Sửa ở đây chứ không ở bước tải: lỗi nằm sẵn
 * trong bài trên wiki, tải lại bao nhiêu lần cũng ra như thế.
 *
 * Chỉ liệt kê những chuỗi đã gặp và những chuỗi cùng họ gần kề. Không đổi bảng
 * mã cả chuỗi vì cách đó sẽ phá hỏng tên riêng viết đúng.
 */
const MOJIBAKE = [
  ['\u00e2\u20ac\u201c', '\u2013'],
  ['\u00e2\u20ac\u201d', '\u2014'],
  ['\u00e2\u20ac\u2122', '\u2019'],
  ['\u00e2\u20ac\u02dc', '\u2018'],
  ['\u00e2\u20ac\u009d', '\u201d'],
  ['\u00e2\u20ac\u009c', '\u201c'],
  ['\u00e2\u20ac\u00a6', '\u2026'],
];

/** Sửa chữ giải mã sai trước mọi bước khác, để các biểu thức sau khớp đúng. */
function repairMojibake(text) {
  let out = text;
  for (const [broken, fixed] of MOJIBAKE) out = out.split(broken).join(fixed);
  // Khoảng trắng không ngắt bị đọc sai thành "Â " — trả về khoảng trắng thường.
  return out.replace(/\u00c2(?=[\s\u00a0])/g, '').replace(/\u00a0/g, ' ');
}

export function cleanWikitext(text = '') {
  // {{!}} là cách wiki viết ký tự `|` bên trong bảng — khôi phục trước khi gỡ template,
  // nếu không giá trị kiểu "133 {{!}} 0%" sẽ mất dấu phân cách.
  // Chú thích ẩn của MediaWiki không phải nội dung hiển thị; gỡ trước mọi bước khác
  // để chuỗi kiểu "80 / 11.7 %<!--Offensive stats-->" không lọt vào giá trị stats.
  let out = repairMojibake(text).replace(/<!--[\s\S]*?-->/g, '');

  out = out.replace(/\{\{\s*!\s*\}\}/g, '|');

  // Template hiển-thị-chữ: giữ lại đối số chứa nội dung.
  // Tên template trên wiki nhập không nhất quán hoa/thường ({{colors}} và {{Colors}}).
  const keepLast = ['[Cc]olors', '[Cc]aption', 'IconDesc', 'IconSmall', 'stack', 'buff', 'debuff', 'heal', 'shield', '[Tt]ướng'];
  for (let pass = 0; pass < 6; pass++) {
    const before = out;
    for (const name of keepLast) {
      out = out.replace(new RegExp(`\\{\\{${name}\\|([^{}]*)\\}\\}`, 'g'), (_, args) => {
        const parts = args.split('|');
        // {{IconDesc|icon|chữ}} -> lấy phần chữ; {{colors|chữ}} -> lấy chính nó.
        return parts.length > 1 ? parts[parts.length - 1] : parts[0];
      });
    }
    if (out === before) break;
  }

  out = out.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '');

  // Gỡ template còn lại từ trong ra ngoài. Một lượt regex không đủ vì template
  // lồng nhau (infobox chứa template con) sẽ còn lại lớp vỏ ngoài.
  let prev;
  do {
    prev = out;
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  } while (out !== prev);

  // Gỡ liên kết không gian tên trước khi rút gọn liên kết thường. Nếu để lọt
  // xuống bước dưới thì "[[Category:Heroes]]" bị bóc vỏ thành dòng chữ
  // "Category:Heroes" nằm lại trong tiểu sử — đúng thứ đang hiện ở trang Dolia.
  out = out.replace(new RegExp(`\\[\\[(?:${NAMESPACES}):[^\\]]*\\]\\]`, 'gi'), '');

  out = out
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')  // [[đích|hiển thị]] -> hiển thị
    .replace(/\[\[([^\]]*)\]\]/g, '$1')           // [[trang]] -> trang
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1') // [url nhãn] -> nhãn
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(small|b|i|big|center|div|span|gallery)[^>]*>/gi, '')
    .replace(/'''?/g, '')                 // đậm/nghiêng
    .replace(/^[:*#]+\s*/gm, '')          // đầu dòng danh sách
    // Dòng chỉ còn tên không gian tên: hoặc do bước trên bóc vỏ ở lần crawl cũ,
    // hoặc do nguồn viết thiếu dấu ngoặc. Cách nào cũng không phải nội dung.
    .replace(new RegExp(`^(?:${NAMESPACES}):.*$`, 'gim'), '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  return out.trim();
}

/**
 * Cắt nội dung một mục `== Tiêu đề ==` (không lấy các mục con phía sau cùng cấp).
 *
 * Tiêu đề được ghép thẳng vào biểu thức nên phải thoát ký tự đặc biệt: trang của
 * Kaine và Stuart có hai mục kỹ năng, phân biệt bằng ngoặc đơn
 * ("== Kỹ năng (Kaine) ==" và "== Kỹ năng (Batman) =="). Không thoát thì cặp
 * ngoặc thành nhóm bắt của regex, biểu thức đi tìm chuỗi không có ngoặc và
 * không khớp mục nào cả.
 */
export function section(text = '', heading) {
  const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(={2,})\\s*'*${escaped}'*\\s*\\1\\s*$`, 'im');
  const match = text.match(re);
  if (!match) return null;

  const level = match[1].length;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  // Dừng ở tiêu đề tiếp theo có cấp bằng hoặc cao hơn.
  const next = rest.search(new RegExp(`^={2,${level}}[^=]`, 'm'));
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/** Các dòng gạch đầu dòng `*` trong một mục -> mảng chuỗi đã làm sạch. */
export function bulletList(sectionText = '') {
  return sectionText
    .split('\n')
    .filter((line) => /^\*+\s*\S/.test(line))
    .map((line) => cleanWikitext(line))
    .filter(Boolean);
}

/**
 * Mọi dòng có nội dung trong một mục, giữ cả gạch đầu dòng.
 * Dùng cho phần lịch sử cân bằng: nội dung ở đó chủ yếu là danh sách,
 * nếu dùng `paragraphs()` sẽ mất gần hết.
 */
export function textLines(sectionText = '') {
  return cleanWikitext(
    sectionText
      .replace(/\{\|[\s\S]*?\|\}/g, '')  // bỏ bảng
      .replace(/^=+.*$/gm, '')           // bỏ tiêu đề con
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Đoạn văn (không phải bảng, danh sách, tiêu đề) -> mảng chuỗi đã làm sạch. */
export function paragraphs(sectionText = '') {
  return cleanWikitext(
    sectionText
      .replace(/\{\|[\s\S]*?\|\}/g, '')   // bỏ bảng
      .replace(/^[*#:].*$/gm, '')          // bỏ danh sách
      .replace(/^=+.*$/gm, '')             // bỏ tiêu đề con
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
