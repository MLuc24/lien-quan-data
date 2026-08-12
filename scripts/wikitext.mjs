/**
 * Bộ đọc wikitext MediaWiki cho dữ liệu Fandom.
 *
 * Không dùng regex đơn lẻ để lấy template: các template ở đây lồng nhau
 * ({{Thông tin tướng|lane={{Icon Role Lane|top}}}}), regex sẽ dừng ở `}}` đầu tiên
 * và cắt mất phần lớn tham số. Ở đây quét theo cặp ngoặc cân bằng.
 */

/** Tìm template `{{name...}}` đầu tiên, trả về phần bên trong (đã cân bằng ngoặc). */
export function extractTemplate(text, name) {
  const start = text.indexOf(`{{${name}`);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; continue; }
    if (text[i] === '}' && text[i + 1] === '}') {
      depth--;
      if (depth === 0) return text.slice(start + 2 + name.length, i);
      i++;
    }
  }
  return null;
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
export function cleanWikitext(text = '') {
  // {{!}} là cách wiki viết ký tự `|` bên trong bảng — khôi phục trước khi gỡ template,
  // nếu không giá trị kiểu "133 {{!}} 0%" sẽ mất dấu phân cách.
  // Chú thích ẩn của MediaWiki không phải nội dung hiển thị; gỡ trước mọi bước khác
  // để chuỗi kiểu "80 / 11.7 %<!--Offensive stats-->" không lọt vào giá trị stats.
  let out = text.replace(/<!--[\s\S]*?-->/g, '');

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

  out = out
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')  // [[đích|hiển thị]] -> hiển thị
    .replace(/\[\[([^\]]*)\]\]/g, '$1')           // [[trang]] -> trang
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1') // [url nhãn] -> nhãn
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(small|b|i|big|center|div|span|gallery)[^>]*>/gi, '')
    .replace(/'''?/g, '')                 // đậm/nghiêng
    .replace(/^[:*#]+\s*/gm, '')          // đầu dòng danh sách
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  return out.trim();
}

/** Cắt nội dung một mục `== Tiêu đề ==` (không lấy các mục con phía sau cùng cấp). */
export function section(text = '', heading) {
  const re = new RegExp(`^(={2,})\\s*'*${heading}'*\\s*\\1\\s*$`, 'im');
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
