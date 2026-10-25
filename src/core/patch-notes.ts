// Pure handling of the game's Steam announcements (store.steampowered.com events API): picking the
// patch notes and turning Steam's BBCode into Discord markdown.

export interface PatchNote {
  /** Steam event id, the one in store.steampowered.com/news/app/<app>/view/<id>. */
  id: string;
  title: string;
  postedAt: Date;
  /** Discord markdown. */
  body: string;
  url: string;
  imageUrl: string | null;
}

/** Steam's ELanguage index for Brazilian Portuguese, used by localized image arrays. */
const BRAZILIAN = 22;
const CLAN_IMAGES = 'https://clan.akamai.steamstatic.com/images';
/** Private-use stand-ins for "[" and "]" that the tag rules must not touch. */
const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Steam BBCode → Discord markdown: headings and bold, bullet lists, links; images dropped. */
export function bbcodeToMarkdown(input: string): string {
  let depth = 0;
  const out = input
    .replace(/\u200b/g, '')
    // Literal brackets (written \[) and link brackets are kept away from the tag rules below.
    .replaceAll('\\[', OPEN)
    .replace(
      /\[url=["']?([^"'\]]+)["']?\]([\s\S]*?)\[\/url\]/gi,
      (_, href: string, text: string) =>
        text.trim() ? `${OPEN}${text.trim()}${CLOSE}(${href})` : href,
    )
    .replace(/\[img[^\]]*\][\s\S]*?\[\/img\]|\[img[^\]]*\]/gi, '')
    .replace(
      /\[h[1-6][^\]]*\]([\s\S]*?)\[\/h[1-6]\]/gi,
      (_, inner: string) => `\n**${inner.replace(/\[\/?b\]/gi, '').trim()}**\n`,
    )
    .replace(/\[(\/?)(list|olist|\*)[^\]]*\]/gi, (_, close: string, tag: string) => {
      if (tag === '*') {
        if (close) return '\n';
        return `\n${'  '.repeat(Math.max(depth - 1, 0))}${depth > 1 ? '◦' : '•'} `;
      }
      depth += close ? -1 : 1;
      return '\n';
    })
    .replace(/\[\/?b\]/gi, '**')
    .replace(/\[\/?i\]/gi, '*')
    .replace(/\[\/?u\]/gi, '__')
    .replace(/\[\/?strike\]/gi, '~~')
    .replace(/\[\/td\]/gi, ' · ')
    .replace(/\[\/(p|tr|table)\]|\[br\]/gi, '\n')
    .replace(/\[\/?[a-z][a-z0-9]*(?:[ =][^\]]*)?\]/gi, '')
    .replaceAll(OPEN, '[')
    .replaceAll(CLOSE, ']')
    // Bold markers around nothing read as stray asterisks.
    .replace(/\*\*[ \t]*\*\*/g, '');
  return out
    .split('\n')
    .map((line) => line.replace(/\s+$/, '').replace(/ ·$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(•|◦) \n+/g, '$1 ')
    .replace(/\n\n+( *[•◦] )/g, '\n$1')
    .trim();
}

export interface PatchSummary {
  /** "Notas da Atualização" from "[Aviso] Notas da Atualização | 20 outubro (PDT) / …". */
  name: string;
  /** What follows the "|" in the title, e.g. "20 outubro (PDT) / 21 outubro (CEST)". */
  when: string | null;
  /** The opening line after the greeting, e.g. "Confira a atualização desta semana." */
  intro: string | null;
  /** Each "[Section]" heading with the topics highlighted in bold under it. */
  sections: { title: string; highlights: string[] }[];
}

const MAX_HIGHLIGHTS = 4;
const MAX_HIGHLIGHT_LENGTH = 60;
/** Bold lines that are table column headers, not topics ("Nome do Item", "Quantidade"…). */
const TABLE_HEADER =
  /^(nome( d[aoe]s?)? .+|item( d[aoe]s? .+)?|itens|quantidade( de .+)?|pre[çc]o|descri[çc][ãa]o|categoria|ra[çc]a|regi[ãa]o|recompensas?|mudan[çc]as|imagem|efeito|material|limite( de .+)?|moeda( de .+)?|cidade .+|n[íi]vel( para .+)?|conte[úu]dos?|data( de .+)?|negociar.*|redefini[çc][ãa]o.*|detalhes( d[aoe]s? .+)?)$/i;

/** The patch notes boiled down to their name, date, opening line and highlighted topics. */
export function summarizePatchNote(note: Pick<PatchNote, 'title' | 'body'>): PatchSummary {
  const [rawName = note.title, ...rest] = note.title.split('|');
  const name = rawName.replace(/^\s*\[[^\]]*\]\s*/, '').trim() || note.title.trim();
  const when = rest.join('|').trim() || null;

  const lines = note.body.split('\n').map((line) => line.trim());
  const bold = (line: string) => /^\*\*[^*]+\*\*$/.test(line);
  const plain = (line: string) => line.replace(/\*\*/g, '').trim();

  const intro =
    lines.find((line) => line && !bold(line) && !/^[•◦]/.test(line) && line.length <= 200) ?? null;

  const sections: PatchSummary['sections'] = [];
  for (const line of lines) {
    if (!bold(line)) continue;
    const text = plain(line);
    const section = /^\[(.+)\]$/.exec(text);
    if (section) {
      sections.push({ title: section[1]!.trim(), highlights: [] });
      continue;
    }
    const current = sections.at(-1);
    if (!current || current.highlights.length >= MAX_HIGHLIGHTS) continue;
    const topic = text.replace(/^(\d+[.)]|■|[a-z]\))\s*/i, '').trim();
    if (!topic || topic.length > MAX_HIGHLIGHT_LENGTH || TABLE_HEADER.test(topic)) continue;
    // "Melhorias" under "[Outras Melhorias e Correções]" says nothing new.
    if (current.title.toLowerCase().includes(topic.toLowerCase())) continue;
    if (!current.highlights.includes(topic)) current.highlights.push(topic);
  }
  return { name, when, intro, sections };
}

/** Announcements whose title contains one of the phrases (any case), oldest first. */
export function parsePatchNotes(
  json: unknown,
  appId: number,
  titleMatches: readonly string[],
): PatchNote[] {
  const events = obj(json).events;
  if (!Array.isArray(events)) return [];
  const wanted = titleMatches.map((m) => m.toLowerCase());
  const notes: PatchNote[] = [];
  for (const event of events.map(obj)) {
    const id = str(event.gid);
    const title = str(event.event_name).trim();
    const announcement = obj(event.announcement_body);
    const posted = Number(announcement.posttime ?? event.rtime32_start_time);
    if (!id || !title || !Number.isFinite(posted)) continue;
    if (!wanted.some((m) => title.toLowerCase().includes(m))) continue;

    let imageUrl: string | null = null;
    try {
      const images = obj(JSON.parse(str(event.jsondata) || '{}')).localized_capsule_image;
      const hash = Array.isArray(images) ? str(images[BRAZILIAN]) || str(images[0]) : '';
      const clan = str(event.clan_steamid);
      if (hash && clan) {
        imageUrl = `${CLAN_IMAGES}/${(BigInt(clan) & 0xffffffffn).toString()}/${hash}`;
      }
    } catch {
      imageUrl = null;
    }
    notes.push({
      id,
      title,
      postedAt: new Date(posted * 1000),
      body: bbcodeToMarkdown(str(announcement.body)),
      url: `https://store.steampowered.com/news/app/${appId}/view/${id}`,
      imageUrl,
    });
  }
  return notes.sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
}
