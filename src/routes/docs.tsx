import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, Search } from 'lucide-react';
import { LegalFooter } from '@/components/cartel/LegalFooter';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { articleById, categoryHref, docs, docsHref, searchDocs, type DocArticle } from '@/lib/docs-content';

type DocsSearch = {
  article?: string;
  category?: string;
  q?: string;
};

export const Route = createFileRoute('/docs')({
  validateSearch: (search: Record<string,unknown>): DocsSearch => ({
    article: typeof search['article'] === 'string' ? search['article'] : undefined,
    category: typeof search['category'] === 'string' ? search['category'] : undefined,
    q: typeof search['q'] === 'string' ? search['q'] : undefined,
  }),
  head: ({ match }) => {
    const article = match.search.article ? articleById[match.search.article] : undefined;
    const title = article ? `${article.title} | CARTEL HQ Help Center` : 'CARTEL HQ Documentation | Help Center';
    const description = article?.summary ?? 'Step-by-step Cartel HQ guides for account setup, Telegram, community management, missions, stickers, Launch Watch, billing and Service Partners.';
    const canonical = `https://pepecartelhq.com${article ? docsHref(article.id) : '/docs'}`;
    return { meta: [{title},{name:'description',content:description},{property:'og:title',content:title},{property:'og:description',content:description},{property:'og:type',content:'website'},{property:'og:url',content:canonical},{name:'twitter:card',content:'summary_large_image'}],links:[{rel:'canonical',href:canonical}] };
  },
  component: DocsPage,
});

const linkClass = 'inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm';
const sectionId = (index: number) => `section-${index+1}`;

function ArticleCard({ article }: { article: DocArticle }) {
  return <a href={docsHref(article.id)} className="group block min-w-0 rounded-lg border border-border-subtle bg-surface-quiet p-4 transition-colors hover:border-gold/50 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:p-5">
    <h3 className="flex items-start justify-between gap-3 text-base font-semibold leading-6 text-foreground"><span>{article.title}</span><ChevronRight className="mt-1 size-4 shrink-0 text-gold" aria-hidden="true" /></h3>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{article.summary}</p>
  </a>;
}

function CategoryNavigation({ active }: { active?: string | undefined }) {
  return <nav aria-label="Documentation categories" className="space-y-1">
    <a href="/docs" className={`${linkClass} w-full px-3 ${!active?'bg-gold/10':''}`}>All documentation</a>
    {docs.categories.map(category=><a key={category.id} href={categoryHref(category.id)} aria-current={active===category.id?'page':undefined} className={`flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm leading-5 transition-colors hover:bg-gold/5 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold ${active===category.id?'bg-gold/10 font-semibold text-gold':'text-muted-foreground'}`}><span>{category.title}</span><span className="text-xs tabular-nums">{docs.articles.filter(article=>article.category===category.id).length}</span></a>)}
  </nav>;
}

function DocsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query,setQuery] = useState(search.q??'');
  const [zoom,setZoom] = useState<{src:string;alt:string}|null>(null);
  useEffect(()=>{setQuery(search.q??'');},[search.q]);
  useEffect(()=>{
    const resolveLegacy = () => {
      if (search.article || search.category || search.q) return;
      const hash = window.location.hash.slice(1);
      const target = docs.legacy[hash];
      if (target) void navigate({search:{article:target,category:undefined,q:undefined},hash:'',replace:true});
    };
    resolveLegacy();
    window.addEventListener('hashchange',resolveLegacy);
    return ()=>window.removeEventListener('hashchange',resolveLegacy);
  },[search.article,search.category,search.q,navigate]);
  const article = search.article ? articleById[search.article] : undefined;
  const activeCategory = article?.category ?? search.category;
  const category = docs.categories.find(item=>item.id===activeCategory);
  const results = searchDocs(query);
  const searching = !!query.trim();
  const peers = article ? docs.articles.filter(item=>item.category===article.category) : [];
  const index = article ? peers.findIndex(item=>item.id===article.id) : -1;
  const previous = peers[index-1];
  const next = peers[index+1];
  return <div className="min-h-screen bg-background text-foreground">
    <a href="#docs-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:p-3 focus:text-gold">Skip to documentation</a>
    <header className="app-gutter sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle bg-background/95 py-2 backdrop-blur-xl">
      <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2"><span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-surface-raised font-display text-sm text-gold">C</span><span className="font-display text-lg uppercase tracking-widest text-gold">CARTEL HQ</span></Link>
      <nav aria-label="Public" className="flex flex-wrap items-center gap-3 text-xs font-semibold"><a href="/docs" className="inline-flex min-h-11 items-center text-muted-foreground hover:text-gold">Help Center</a><Link to="/dashboard" className="inline-flex min-h-11 items-center text-gold hover:underline">Open HQ</Link><Link to="/auth" className="inline-flex min-h-11 items-center text-muted-foreground hover:text-gold">Sign in</Link></nav>
    </header>
    <main id="docs-main" className="app-gutter mx-auto max-w-7xl py-8 sm:py-12">
      <div className="max-w-4xl">
        <p className="type-eyebrow text-gold">Product documentation</p>
        <h1 className="mt-3 font-display text-4xl uppercase leading-none sm:text-6xl">Cartel HQ Help Center</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">Set up your project, connect Telegram and learn each tool step by step.</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Production verified 30 September 2026. Guides identify plan, permission and verification limits.</p>
      </div>
      <form method="get" action="/docs" role="search" className="mt-6 flex max-w-3xl items-center gap-2">
        <label htmlFor="docs-search" className="sr-only">Search documentation</label>
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true"/><input id="docs-search" name="q" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search setup, missions, billing…" className="min-h-11 w-full rounded-md border border-border-subtle bg-surface-quiet py-3 pl-10 pr-3 text-sm text-foreground outline-none focus:border-gold focus:ring-1 focus:ring-gold"/></div>
        <button type="submit" className="min-h-11 rounded-md bg-gold px-4 text-sm font-semibold text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background">Search</button>
      </form>
      {searching?<p aria-live="polite" className="mt-2 text-sm text-muted-foreground">{results.length} {results.length===1?'guide':'guides'} found</p>:null}
      <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
          <div className="hidden lg:block"><p className="type-eyebrow mb-3 px-3 text-muted-foreground">Browse topics</p><CategoryNavigation active={activeCategory}/></div>
          <details className="rounded-lg border border-border-subtle bg-surface-quiet p-3 lg:hidden"><summary className="min-h-11 cursor-pointer py-3 font-semibold text-gold">Browse topics{category?`: ${category.title}`:''}</summary><CategoryNavigation active={activeCategory}/></details>
        </aside>
        <div className="min-w-0">
          {searching?<section aria-labelledby="results-title"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="results-title" className="font-display text-3xl uppercase">Search results</h2><a href="/docs" className={linkClass}>Clear search</a></div>{results.length?<div className="mt-4 grid gap-3 sm:grid-cols-2">{results.map(item=><ArticleCard key={item.id} article={item}/>)}</div>:<div className="mt-4 rounded-lg border border-border-subtle p-5"><p>No guide matches “{query}”. Try a shorter phrase such as Telegram, welcome, motion or billing.</p><a href="/docs" className={`${linkClass} mt-3`}>Browse all categories</a></div>}</section>:
          article?<article>
            <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground"><a href="/docs" className="min-h-8 hover:text-gold">Documentation</a><ChevronRight className="size-3" aria-hidden="true"/>{category?<a href={categoryHref(category.id)} className="min-h-8 hover:text-gold">{category.title}</a>:null}</nav>
            <p className="type-eyebrow text-gold">{category?.title}</p>
            <h2 className="mt-3 font-display text-3xl uppercase leading-tight sm:text-4xl">{article.title}</h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">{article.summary}</p>
            <dl className="mt-5 space-y-3 rounded-lg border border-border-subtle bg-surface-quiet p-4 text-sm leading-6 sm:p-5"><div><dt className="font-semibold text-foreground">Who can use it</dt><dd className="text-muted-foreground">{article.audience}</dd></div><div><dt className="font-semibold text-foreground">Where to find it</dt><dd className="text-muted-foreground">{article.location}</dd></div>{article.prerequisites.length?<div><dt className="font-semibold text-foreground">Before you start</dt><dd><ul className="list-disc space-y-1 pl-5 text-muted-foreground">{article.prerequisites.map(item=><li key={item}>{item}</li>)}</ul></dd></div>:null}</dl>
            <details open className="mt-5 rounded-lg border border-border-subtle p-4"><summary className="min-h-8 cursor-pointer font-semibold text-gold">On this page</summary><nav aria-label="Article contents" className="mt-2 flex flex-col">{article.sections.map((section,i)=><a key={i} href={`#${sectionId(i)}`} className="min-h-9 py-1.5 text-sm text-muted-foreground hover:text-gold">{section.title}</a>)}</nav></details>
            <div className="mt-8 space-y-8">{article.sections.map((section,i)=><section key={i} id={sectionId(i)} className="scroll-mt-24 border-t border-border-subtle pt-6">
              <h3 className="text-xl font-semibold leading-7 text-foreground">{section.title}</h3>
              {section.body.map((paragraph,j)=><p key={j} className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground [overflow-wrap:anywhere]">{paragraph}</p>)}
              {section.steps?<ol className="mt-4 list-decimal space-y-4 pl-6 text-sm leading-7 text-muted-foreground marker:font-semibold marker:text-gold">{section.steps.map((step,j)=><li key={j} className="pl-1 [overflow-wrap:anywhere]">{step}</li>)}</ol>:null}
              {section.rows?<div className="mt-4 overflow-x-auto rounded-md border border-border-subtle"><table className="w-full text-left text-sm leading-6"><thead className="bg-surface-raised"><tr><th scope="col" className="px-3 py-3 font-semibold">Item</th><th scope="col" className="px-3 py-3 font-semibold">Details</th></tr></thead><tbody>{section.rows.map((row,j)=><tr key={j} className="border-t border-border-subtle"><th scope="row" className="w-1/3 min-w-28 px-3 py-3 align-top font-medium text-foreground [overflow-wrap:anywhere]">{row[0]}</th><td className="px-3 py-3 align-top text-muted-foreground [overflow-wrap:anywhere]">{row[1]}</td></tr>)}</tbody></table></div>:null}
              {section.notice?<p className="mt-4 rounded-md border border-gold/30 bg-gold/5 p-4 text-sm leading-6">{section.notice}</p>:null}
              {section.image?<figure className="mt-5 min-w-0"><button type="button" onClick={()=>setZoom(section.image ?? null)} className="block w-full overflow-hidden rounded-lg border border-border-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" aria-label={`Enlarge screenshot: ${section.image.alt}`}><img src={section.image.src} alt={section.image.alt} loading="lazy" className="h-auto w-full"/></button><figcaption className="mt-2 text-xs leading-5 text-muted-foreground">{section.image.caption} Select the image to enlarge.</figcaption></figure>:null}
            </section>)}</div>
            <section className="mt-10 border-t border-border-subtle pt-6" aria-labelledby="related-title"><h3 id="related-title" className="font-display text-2xl uppercase">Related guides</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{article.related.map(id=>articleById[id]?<ArticleCard key={id} article={articleById[id]}/>:null)}</div></section>
            <nav aria-label="Previous and next guides" className="mt-7 grid gap-3 sm:grid-cols-2">{previous?<a href={docsHref(previous.id)} className="rounded-lg border border-border-subtle p-4 hover:border-gold/50"><span className="flex items-center gap-2 text-xs text-gold"><ArrowLeft className="size-4" aria-hidden="true"/>Previous guide</span><span className="mt-2 block text-sm leading-6">{previous.title}</span></a>:<a href={category?categoryHref(category.id):'/docs'} className={`${linkClass} p-4`}>Back to category</a>}{next?<a href={docsHref(next.id)} className="rounded-lg border border-border-subtle p-4 hover:border-gold/50"><span className="flex items-center gap-2 text-xs text-gold">Next guide<ArrowRight className="size-4" aria-hidden="true"/></span><span className="mt-2 block text-sm leading-6">{next.title}</span></a>:<a href="/docs" className={`${linkClass} p-4`}>Browse all documentation<ArrowRight className="size-4" aria-hidden="true"/></a>}</nav>
          </article>:
          category?<section><a href="/docs" className={linkClass}><ArrowLeft className="size-4" aria-hidden="true"/>All documentation</a><h2 className="mt-4 font-display text-3xl uppercase sm:text-4xl">{category.title}</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">{category.description}</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{docs.articles.filter(item=>item.category===category.id).map(item=><ArticleCard key={item.id} article={item}/>)}</div></section>:
          <>
            {search.article||search.category?<div role="status" className="mb-5 rounded-md border border-gold/30 bg-gold/5 p-4 text-sm">That guide or category could not be found. Choose a current topic below.</div>:null}
            <section className="rounded-lg border border-gold/30 bg-gold/5 p-5 sm:p-6"><p className="type-eyebrow text-gold">Start here</p><h2 className="mt-2 font-display text-3xl uppercase">New to Cartel HQ?</h2><p className="mt-3 text-sm leading-7 text-muted-foreground">Create your own account and project, save your identity, connect the bot and configure welcomes. Choose paid tools when you need them.</p><a href={docsHref('first-session')} className={`${linkClass} mt-3`}>Follow your first-session guide<ArrowRight className="size-4" aria-hidden="true"/></a></section>
            <section className="mt-7" aria-labelledby="topics-title"><h2 id="topics-title" className="font-display text-3xl uppercase">Browse documentation</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">{docs.categories.map(item=><section key={item.id} id={item.id} className="scroll-mt-24 rounded-lg border border-border-subtle bg-surface-quiet p-5"><BookOpen className="size-5 text-gold" aria-hidden="true"/><h3 className="mt-3 text-lg font-semibold"><a href={categoryHref(item.id)} className="hover:text-gold">{item.title}</a></h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p><ul className="mt-3 space-y-1">{docs.articles.filter(a=>a.category===item.id).map(a=><li key={a.id}><a href={docsHref(a.id)} className="inline-flex min-h-10 items-center py-1 text-sm leading-5 text-gold hover:underline">{a.title}</a></li>)}</ul></section>)}</div></section>
          </>}
        </div>
      </div>
    </main>
    <footer className="app-gutter mt-8 border-t border-border-subtle py-6"><LegalFooter/></footer>
    <Dialog open={!!zoom} onOpenChange={open=>{if(!open)setZoom(null);}}><DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-6xl overflow-auto p-4 sm:p-6"><DialogTitle className="pr-8">Documentation screenshot</DialogTitle><DialogDescription>{zoom?.alt} On a narrow screen, scroll horizontally to read at full resolution.</DialogDescription>{zoom?<div className="overflow-auto"><img src={zoom.src} alt={zoom.alt} className="h-auto max-w-none sm:w-full sm:max-w-full"/></div>:null}</DialogContent></Dialog>
  </div>;
}
