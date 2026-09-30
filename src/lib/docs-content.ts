import content from './docs-data';

export type DocImage = { src: string; alt: string; caption: string };
export type DocSection = { title: string; body: string[]; steps?: string[]; rows?: string[][]; notice?: string; image?: DocImage };
export type DocArticle = { id: string; category: string; title: string; summary: string; audience: string; location: string; prerequisites: string[]; sections: DocSection[]; related: string[] };
export type DocCategory = { id: string; title: string; description: string };
export const docs = content as { verifiedAt: string; categories: DocCategory[]; articles: DocArticle[]; legacy: Record<string,string> };
export const articleById = Object.fromEntries(docs.articles.map(article => [article.id,article])) as Record<string,DocArticle>;
export const docsHref = (article: string) => `/docs?article=${encodeURIComponent(article)}`;
export const categoryHref = (category: string) => `/docs?category=${encodeURIComponent(category)}`;
export function searchDocs(query: string): DocArticle[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return docs.articles.map(article => {
    const title = `${article.title} ${article.summary}`.toLowerCase();
    const all = `${title} ${article.audience} ${article.location} ${article.prerequisites.join(' ')} ${article.sections.map(section=>`${section.title} ${section.body.join(' ')} ${(section.steps??[]).join(' ')} ${(section.rows??[]).flat().join(' ')}`).join(' ')}`.toLowerCase();
    return { article, match: words.every(word=>all.includes(word)), score: words.reduce((score,word)=>score+(title.includes(word)?2:0),0) };
  }).filter(item=>item.match).sort((a,b)=>b.score-a.score).map(item=>item.article);
}
