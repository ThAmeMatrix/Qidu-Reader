import type { Book, Chapter, LibraryState } from '../types';

const sampleInfo = [
  ['瓦尔登湖', '亨利·戴维·梭罗', 'WALDEN', '把日子过得简单，把内心留给丰盛。', '自然与生活'],
  ['人间草木', '汪曾祺', 'WORLD OF PLANTS', '草木有本心，生活有滋味。', '散文随笔'],
  ['小王子', '安托万·德·圣-埃克苏佩里', 'LE PETIT PRINCE', '在很小的星球上，发现很大的世界。', '文学小说'],
  ['月亮与六便士', '威廉·萨默塞特·毛姆', 'THE MOON AND SIXPENCE', '在日常与远方之间，寻找自己的答案。', '文学小说'],
  ['悉达多', '赫尔曼·黑塞', 'SIDDHARTHA', '听一条河，讲述关于时间的故事。', '文学小说'],
  ['飞鸟集', '拉宾德拉纳特·泰戈尔', 'STRAY BIRDS', '细小的事物里，也藏着广阔的宇宙。', '诗歌与哲思'],
];

export const sampleEnglish = sampleInfo.map(b => b[2]);
export const sampleBooks: Book[] = sampleInfo.map((b, i) => ({
  id: `sample-${i}`, title: b[0], author: b[1], format: 'TXT',
  status: i < 2 ? 'reading' : 'want', progress: 0, cover: i,
  collectionIds: i === 0 || i === 1 || i === 5 ? ['essays'] : ['literature'],
  addedAt: Date.now() - i * 1000, size: 0, sample: true, description: b[3],
}));

const paragraphs = [
  '阅读有时候是一场安静的散步。没有人催促，也没有一条必须抵达的终点线。我们只是翻开书页，让注意力从纷繁的消息中收回来，停留在一段文字、一阵风，或一个从未认真想过的问题上。',
  '不妨先看看窗外。树叶正在用自己的速度生长，云也有它缓慢的路线。生活并不总是需要更快的答案。有些感受要等一等，才会从熟悉的日常里浮现，就像泡在水中的茶叶，慢慢舒展出原来的样子。',
  '一本书的意义，也许不只在于它告诉了我们什么，还在于合上书以后，我们开始怎样观察身边的世界。原本普通的一条小路，可能因为某句话而有了新的光线；一次寻常的相遇，也可能让人想起书中未说完的故事。',
  '试着为今天的阅读留下一点空白。读到喜欢的地方，可以慢下来，做一条摘录，或者写下此刻的想法。不必寻找漂亮的表达，真正属于自己的感受，即使只有一句话，也值得被珍藏。',
  '我们往往习惯于收集更多，却不常练习如何看见已经拥有的东西。一杯温水，一张靠窗的桌子，一段完整而不受打扰的时间，都能成为阅读的起点。所谓丰盛，有时只是重新认识那些一直陪伴我们的细节。',
  '当你下一次翻开这本书，今天的笔记也许会成为一封写给未来的信。那个时候的你可能有不同的理解，也可能仍然为同样的句子停留。文字留在原地，而我们已经走过新的风景。',
];

export function sampleChapters(book: Book): Chapter[] {
  const themes = ['从一页开始', '在日常中发现远方', '留一点时间给自己', '把感受写下来'];
  return themes.map((title, i) => ({
    id: `chapter-${i}`,
    title: `${['一', '二', '三', '四'][i]} · ${title}`,
    html: `<h2>${title}</h2><p class="chapter-lead">${book.description}</p>${paragraphs.slice(i).concat(paragraphs.slice(0, i)).map(p => `<p>${p}</p>`).join('')}<p class="chapter-end">· · ·</p>`,
  }));
}

export const initialState: LibraryState = {
  version: 1, books: sampleBooks, reviews: [], notes: [],
  collections: [
    { id: 'literature', name: '文学与故事', color: '#a47757' },
    { id: 'essays', name: '散文与日常', color: '#81937c' },
  ],
  settings: {
    reader: { theme: 'paper', font: 'serif', fontSize: 20, lineHeight: 1.9, width: 720 },
    dailyGoal: 30, appTheme: 'light', reduceMotion: false,
  },
  readingSeconds: {},
};
