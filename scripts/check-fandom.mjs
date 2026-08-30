/**
 * Đối chiếu chỗ khuyết của bản VI với wiki thật.
 *
 * Câu hỏi mà bước hợp nhất không tự trả lời được: một tướng không có dữ liệu
 * Fandom VI là vì wiki chưa có bài, hay vì ảnh chụp đã cũ hơn wiki? Bước hợp
 * nhất chỉ nhìn thấy tệp trong `data/raw/`, còn tệp đó thì nằm ngoài git.
 *
 * Script này hỏi thẳng wiki. Có bài trên wiki mà dữ liệu đang commit vẫn để
 * trống nghĩa là ảnh chụp cũ, và đó là lỗi cần sửa bằng `npm run data` chứ
 * không phải một khoảng trống trung thực.
 *
 * Thoát mã 1 khi tìm thấy chênh lệch, để chạy được trong kiểm tra tự động.
 */
import { readFile } from 'node:fs/promises';
import { UA } from './lib.mjs';
import { CRAWL_INFO, describeSnapshot, readCrawlInfo } from './crawl-info.mjs';

const API = 'https://arenaofvalor.fandom.com/vi/api.php';
const BATCH = 50;

/** Tên bài có thật trên wiki, trong số những tên được hỏi. */
export async function existingTitles(titles, fetchImpl = fetch) {
  const found = [];

  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    const url =
      `${API}?format=json&formatversion=2&action=query&prop=revisions` +
      `&rvprop=timestamp&titles=${encodeURIComponent(batch.join('|'))}`;

    const response = await fetchImpl(url, { headers: { 'User-Agent': UA } });
    if (!response.ok) throw new Error(`wiki trả ${response.status}`);

    const data = await response.json();
    for (const page of data.query?.pages ?? []) {
      // `missing` là cách wiki nói "không có bài này"; thiếu cờ đó nghĩa là có.
      if (!page.missing) found.push({ title: page.title, editedAt: page.revisions?.[0]?.timestamp });
    }
  }

  return found;
}

async function main() {
  const heroes = JSON.parse(await readFile('data/heroes.json', 'utf8'));
  const missing = heroes.filter((hero) => !hero.sources?.fandomVi);

  const info = await readCrawlInfo();
  console.log(`Ảnh chụp Fandom VI: ${describeSnapshot(info['fandom-vi'])}`);
  console.log(`Tướng chưa có nguồn VI trong dữ liệu đang commit: ${missing.length}/${heroes.length}`);

  const found = await existingTitles(missing.map((hero) => hero.name));

  if (found.length === 0) {
    console.log('\nKhông có bài nào trên wiki mà dữ liệu bỏ sót. Chỗ khuyết là khuyết thật.');
    return;
  }

  console.log(`\nWiki đã có ${found.length} bài mà dữ liệu đang commit vẫn để trống:`);
  for (const page of found.sort((a, b) => a.title.localeCompare(b.title))) {
    console.log(`  ${page.title.padEnd(14)} sửa lần cuối ${page.editedAt?.slice(0, 10) ?? '?'}`);
  }
  console.log(`\nẢnh chụp đã cũ hơn wiki. Chạy \`npm run data\` rồi commit lại data/heroes.json.`);
  console.log(`Mốc thời gian của lần crawl gần nhất nằm ở ${CRAWL_INFO}.`);
  process.exit(1);
}

// Chỉ chạy khi gọi trực tiếp, để test còn nhập được `existingTitles`.
if (process.argv[1]?.endsWith('check-fandom.mjs')) {
  main().catch((error) => {
    console.error(`\nLỗi đối chiếu: ${error.message}`);
    process.exit(1);
  });
}
