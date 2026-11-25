import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Carousel, Input, Segmented, Space, Spin, message } from 'antd';
import type { CarouselRef } from 'antd/es/carousel';
import { Link, useSearchParams } from 'react-router';
import Modal from '@/components/DraggableModal';
import { useAuthStore } from '@/stores/authStore';
import { inPreviewFrame } from '@/features/authorization/preview-frame';
import FilePreviewButton from '@/features/files/FilePreviewButton';
import { authenticatedFetch, get } from '@/features/workspaces/api';
import { employeeTypeLabel } from '@/locales/employee-types';
import { assetUrl, blank, labels, portalError, type Card, type Feed, type Kind } from './types';
import './portal.css';
import { PhotoCache } from './photo-cache';

const PhotoContext = createContext<PhotoCache | null>(null);
function photoSource(card: Card, external: boolean, thumbnail: boolean) {
  const source = card.imageUrl || (card.image && assetUrl(card, card.image, external));
  return source && thumbnail ? source + (source.includes('?') ? '&' : '?') + 'thumbnail=1' : source;
}

function Photo({
  card,
  external = false,
  thumbnail = false,
  enabled = true,
}: {
  card: Card;
  external?: boolean;
  thumbnail?: boolean;
  enabled?: boolean;
}) {
  const source = photoSource(card, external, thumbnail);
  const sharedCache = useContext(PhotoContext);
  const ownCache = useMemo(() => new PhotoCache(external), [external]);
  const cache = sharedCache || ownCache;
  useEffect(() => () => ownCache.clear(), [ownCache]);
  const photo = useRef<HTMLImageElement & HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!photo.current || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(photo.current);
    return () => observer.disconnect();
  }, [visible]);
  const [loaded, setLoaded] = useState<{
    source: string;
    url?: string;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!source || !visible || !enabled || inPreviewFrame || !cache) return;
    let active = true;
    const release = cache.retain(source);
    void cache
      .load(source)
      .then((url) => {
        if (active) setLoaded({ source, url });
      })
      .catch(() => {
        if (active) setLoaded({ source, failed: true });
      });
    return () => {
      active = false;
      release();
    };
  }, [source, cache, visible, enabled]);
  const current = enabled && loaded?.source === source ? loaded : undefined;
  return current?.url && source && cache.contains(source, current.url) ? (
    <img
      ref={photo}
      className="portal-photo"
      src={current.url}
      alt={card.caption || card.personName || card.title}
      onError={() => setLoaded({ source: source!, failed: true })}
    />
  ) : source && !current?.failed ? (
    <div ref={photo} className="portal-monogram portal-photo-loading" aria-label="照片加载中" />
  ) : (
    <div ref={photo} className="portal-monogram" aria-hidden="true">
      {(card.personName || card.title).slice(0, 1)}
    </div>
  );
}

function FileActions({ card }: { card: Card }) {
  if (!card.file) return null;
  const file = card.file,
    url = card.fileUrl || assetUrl(card, file);
  async function download() {
    try {
      const response = await authenticatedFetch(url);
      if (!response.ok) throw Error('文件已下架或当前不可下载');
      const blob = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = blob;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blob), 1000);
    } catch (e) {
      message.error(portalError(e));
    }
  }
  return (
    <Space>
      <FilePreviewButton url={url} name={file.name} link />
      <Button size="small" disabled={inPreviewFrame} onClick={download}>
        下载
      </Button>
    </Space>
  );
}

export function Article({ card, external = false }: { card: Card; external?: boolean }) {
  return (
    <article className="portal-article">
      <p className="portal-meta">
        {[labels[card.kind], card.subtitle, card.period, card.date?.slice(0, 10)]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {card.image && (
        <figure>
          <Photo card={card} external={external} />
          {card.caption && <figcaption>{card.caption}</figcaption>}
        </figure>
      )}
      {card.body && <p className="portal-prose">{card.body}</p>}
      {card.file && (
        <>
          <p>
            {card.file.name} · v{card.number}
          </p>
          <FileActions card={card} />
        </>
      )}
    </article>
  );
}

function Slider({
  cards,
  external,
  open,
  multiple = false,
  suspended = false,
}: {
  cards: Card[];
  external: boolean;
  open: (c: Card) => void;
  multiple?: boolean;
  suspended?: boolean;
}) {
  const slider = useRef<CarouselRef>(null);
  const container = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(1);
  useEffect(() => {
    if (!multiple || !container.current) return;
    const resize = (width: number) => {
      setCapacity(width >= 720 ? 5 : width >= 540 ? 3 : width >= 340 ? 2 : 1);
    };
    resize(container.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => resize(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [multiple]);
  const [paused, setPaused] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [index, setIndex] = useState(0);
  const count = multiple ? capacity : 1;
  const cycling = cards.length > count;
  const cache = useContext(PhotoContext);
  // Warm only the visible portraits and the next screen, not the entire roster.
  const sources = Array.from({ length: Math.min(cards.length, count * 2) }, (_, offset) =>
    photoSource(cards[(index + offset) % cards.length], external, true),
  ).filter(Boolean) as string[];
  const batch = JSON.stringify(sources);
  const [readyBatch, setReadyBatch] = useState('');
  useEffect(() => {
    if (!cache || inPreviewFrame) return;
    let active = true;
    const urls: string[] = JSON.parse(batch);
    void Promise.allSettled(urls.map((url) => cache.load(url))).then(() => {
      if (active) setReadyBatch(batch);
    });
    return () => {
      active = false;
    };
  }, [batch, cache]);
  if (!cards.length) return <p className="portal-empty">暂无展示资料</p>;
  return (
    <div
      ref={container}
      className={multiple ? 'portal-slider portal-lawyer-slider' : 'portal-slider'}
    >
      <Carousel
        ref={slider}
        dots={false}
        slidesToShow={count}
        slidesToScroll={1}
        infinite={cycling}
        lazyLoad="ondemand"
        autoplay={!paused && !suspended && cycling && readyBatch === batch}
        autoplaySpeed={multiple ? 5000 : 6500}
        pauseOnFocus
        pauseOnHover
        draggable
        waitForAnimate={false}
        afterChange={setIndex}
      >
        {cards.map((c, position) => (
          <div key={c.id}>
            <button className="portal-person" onClick={() => open(c)}>
              <Photo
                card={c}
                external={external}
                thumbnail
                enabled={(position - index + cards.length) % cards.length < count * 2}
              />
              <span className="portal-person-info">
                <strong>{c.title}</strong>
                <small>{[c.period, c.subtitle].filter(Boolean).join(' · ')}</small>
                <span className="portal-excerpt">{c.body}</span>
              </span>
            </button>
          </div>
        ))}
      </Carousel>
      {(multiple || cycling) && (
        <div className="portal-controls">
          <span>
            {multiple
              ? `共 ${cards.length} 位 · 同时展示 ${Math.min(count, cards.length)} 位`
              : `${index + 1} / ${cards.length}`}
          </span>
          {cycling && (
            <>
              <Button size="small" aria-label="上一位" onClick={() => slider.current?.prev()}>
                ←
              </Button>
              <Button size="small" onClick={() => setPaused(!paused)}>
                {paused ? '播放' : '暂停'}
              </Button>
              <Button size="small" aria-label="下一位" onClick={() => slider.current?.next()}>
                →
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function directory(feed: Feed) {
  const cards = feed.entries;
  const profiles = new Map(cards.filter((c) => c.kind === 'LAWYER').map((c) => [c.subject, c]));
  const lawyers = feed.people
    .filter((p) => p.lawyer)
    .map((p) => {
      const profile = profiles.get(p.id);
      return {
        ...blank,
        ...profile,
        id: profile?.id || p.id,
        subject: p.id,
        kind: 'LAWYER' as const,
        date: profile?.date || null,
        title: p.name,
        personName: p.name,
        subtitle: [...new Set([employeeTypeLabel(p.type), ...p.positions])].join(' · '),
        body: [
          p.directions.length ? '专业方向 · ' + p.directions.join('、') : '',
          profile?.body,
          feed.teams
            .filter((t) => p.teams.includes(t.id))
            .map((t) => t.name)
            .join('、'),
        ]
          .filter(Boolean)
          .join('\n'),
      };
    })
    .sort((a, b) => b.priority - a.priority);
  const teams = feed.teams
    .map((t) => {
      const profile = cards.find((c) => c.kind === 'TEAM' && c.subject === t.id);
      const members = feed.people.filter((p) => p.teams.includes(t.id));
      return {
        ...blank,
        ...profile,
        id: profile?.id || t.id,
        subject: t.id,
        kind: 'TEAM' as const,
        date: profile?.date || null,
        title: t.name,
        body: [
          profile?.body || t.description,
          members.length ? '团队成员 · ' + members.map((p) => p.name).join('、') : '',
        ]
          .filter(Boolean)
          .join('\n'),
      };
    })
    .sort((a, b) => b.priority - a.priority);
  return { lawyers, teams };
}

export default function PortalHome({ external = false }: { external?: boolean }) {
  const userId = useAuthStore((s) => s.authorization?.userId);
  return <ScopedPortalHome key={`${external}:${userId}`} external={external} />;
}
function ScopedPortalHome({ external }: { external: boolean }) {
  const cache = useMemo(() => new PhotoCache(external), [external]);
  useEffect(() => () => cache.clear(), [cache]);
  return (
    <PhotoContext.Provider value={cache}>
      <PortalContent external={external} />
    </PhotoContext.Provider>
  );
}
function PortalContent({ external }: { external: boolean }) {
  const admin = useAuthStore((s) => s.authorization?.isSystemSuperAdmin);
  const [feed, setFeed] = useState<Feed>(),
    [error, setError] = useState(''),
    [retry, refresh] = useState(0);
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<{ title: string; cards: Card[] }>(),
    [category, switchTo] = useState('律师');
  const [directorySearch, setDirectorySearch] = useState('');
  useEffect(() => {
    let current = true;
    const read = external
      ? fetch('/api/v1/showcase', { credentials: 'omit' }).then(async (r) => {
          if (!r.ok) throw Error();
          return (await r.json()).data as Feed;
        })
      : get<Feed>('/portal');
    read
      .then((data) => {
        if (current) {
          setFeed(data);
          setError('');
        }
      })
      .catch((e) => {
        if (current) setError(portalError(e));
      });
    return () => {
      current = false;
    };
  }, [external, retry]);
  if (error)
    return (
      <Alert
        type="error"
        title={error}
        action={<Button onClick={() => refresh(retry + 1)}>重试</Button>}
      />
    );
  if (!feed) return <Spin aria-label="加载承业首页" />;
  const by = (kind: Kind) => feed.entries.filter((c) => c.kind === kind);
  const { lawyers, teams } = directory(feed);
  const people = external ? by('LAWYER') : lawyers,
    groups = external ? by('TEAM') : teams;
  const honors = by('HONOR').map((c) => ({
    ...c,
    subtitle: c.title,
    title: c.personName,
  }));
  const selected = params.get('article');
  const detail = selected
    ? [...people, ...groups, ...honors, ...feed.entries].find((c) => c.id === selected)
    : undefined;
  function open(card?: Card) {
    const next = new URLSearchParams(params);
    if (card) next.set('article', card.id);
    else next.delete('article');
    setParams(next, { preventScrollReset: true });
  }
  const about = [...by('INTRO'), ...by('CULTURE'), ...by('HISTORY')],
    intro = about[0];
  const showAll = (title: string, cards: Card[]) => {
    setDirectorySearch('');
    setList({ title, cards });
  };
  const matchingCards =
    list?.cards.filter((c) =>
      [c.title, c.personName, c.subtitle, c.body]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(directorySearch.trim().toLocaleLowerCase()),
    ) || [];
  function panel(kind: Kind, limit: number) {
    const cards = by(kind);
    if (external && !cards.length) return null;
    return (
      <section className={'portal-panel portal-section-' + kind.toLowerCase()}>
        <header>
          <h2>{labels[kind]}</h2>
          {cards.length > limit && (
            <button onClick={() => showAll(labels[kind], cards)}>查看全部</button>
          )}
        </header>
        {cards.slice(0, limit).map((c) => (
          <div className="portal-list-row" key={c.id}>
            {kind === 'NEWS' && c.image && (
              <div className="portal-thumb">
                <Photo card={c} external={external} thumbnail />
              </div>
            )}
            <button className="portal-row-title" onClick={() => open(c)}>
              {c.pinned && <small>置顶 </small>}
              {c.title}
              <small>
                {kind === 'DOWNLOAD'
                  ? (c.file?.name ?? '') + ' · v' + c.number
                  : c.date?.slice(0, 10)}
              </small>
            </button>
            {kind === 'DOWNLOAD' && <FileActions card={c} />}
          </div>
        ))}
        {!cards.length && (
          <p className="portal-empty">暂无已发布{kind === 'DOWNLOAD' ? '文件' : '内容'}</p>
        )}
      </section>
    );
  }
  return (
    <div className={'portal-page' + (external ? ' portal-public' : '')}>
      <header className="portal-heading">
        <h1>{external ? '承业律师事务所' : '首页'}</h1>
        {!external && admin && <Link to="/admin/portal">管理首页</Link>}
      </header>
      <div className="portal-grid">
        <section className="portal-hero">
          {intro?.image && <Photo card={intro} external={external} />}
          <div>
            <h2>{intro?.title || '承业律师事务所'}</h2>
            {intro?.body && <p className="portal-excerpt">{intro.body}</p>}
            {about.length > 0 && (
              <button
                onClick={() => (about.length === 1 ? open(about[0]) : showAll('了解承业', about))}
              >
                了解承业 →
              </button>
            )}
          </div>
        </section>
        {external ? panel('NEWS', 4) : panel('NOTICE', 4)}
        {!external && (
          <>
            {panel('NEWS', 3)}
            {panel('DOWNLOAD', 4)}
          </>
        )}
        {(!external || people.length + groups.length > 0) && (
          <section className="portal-panel portal-people">
            <header>
              <h2>律师与专业团队</h2>
              <button onClick={() => showAll(category, category === '律师' ? people : groups)}>
                查看全部
              </button>
            </header>
            <Segmented options={['律师', '团队']} value={category} onChange={switchTo} />
            <Slider
              key={category}
              multiple={category === '律师'}
              suspended={Boolean(detail || list)}
              cards={category === '律师' ? people : groups}
              external={external}
              open={open}
            />
          </section>
        )}
        {!external && (
          <section className="portal-panel">
            <header>
              <h2>优秀员工</h2>
              {by('HONOR').length > 1 && (
                <button onClick={() => showAll('优秀员工', by('HONOR'))}>查看全部</button>
              )}
            </header>
            <Slider
              cards={honors}
              external={false}
              open={open}
              suspended={Boolean(detail || list)}
            />
          </section>
        )}
        {panel('CASE', 4)}
      </div>
      {by('CONTACT').map((contact) => (
        <footer className="portal-contact" key={contact.id}>
          <div>
            <h2>{contact.title || '联系我们'}</h2>
            <div className="portal-contact-offices">
              {contact.body
                .split(/\n\s*\n/)
                .filter(Boolean)
                .map((office, index) => {
                  const [name, ...lines] = office.split('\n');
                  return (
                    <section key={index}>
                      <h3>{name}</h3>
                      {lines.map((line, lineIndex) => {
                        const phone = line.match(/^电话[：:]\s*([\d+-]+)\s*$/);
                        return (
                          <p key={lineIndex}>
                            {phone ? <a href={'tel:' + phone[1]}>{line}</a> : line}
                          </p>
                        );
                      })}
                    </section>
                  );
                })}
            </div>
          </div>
          {contact.image && (
            <figure>
              <Photo card={contact} external={external} />
              {contact.caption && <figcaption>{contact.caption}</figcaption>}
            </figure>
          )}
        </footer>
      ))}
      {selected && !detail && (
        <Alert type="info" title="这项内容已下架或不可查看" closable onClose={() => open()} />
      )}
      {list && (
        <Modal open title={list.title} footer={null} onCancel={() => setList(undefined)}>
          <Input
            aria-label="搜索展示资料"
            placeholder={list.title === '律师' ? '搜索姓名、专业方向或所属团队' : '搜索名称或简介'}
            allowClear
            value={directorySearch}
            onChange={(e) => setDirectorySearch(e.target.value)}
          />
          <p className="portal-meta">共 {matchingCards.length} 项</p>
          {matchingCards.length === 0 && <p>暂无匹配资料</p>}
          <div className="portal-directory-results">
            {matchingCards.map((c) => (
              <button className="portal-choice" key={c.id} onClick={() => open(c)}>
                {c.title}
                {c.personName && c.personName !== c.title ? ' · ' + c.personName : ''}
                {list.title === '律师' && <small className="portal-meta">{c.subtitle}</small>}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {detail && (
        <Modal open title={detail.title} footer={null} onCancel={() => open(undefined)} width={760}>
          <Article card={detail} external={external} />
          {detail.kind === 'TEAM' && !external && (
            <Space wrap>
              {people
                .filter((c) =>
                  feed.people.find((p) => p.id === c.subject)?.teams.includes(detail.subject || ''),
                )
                .map((c) => (
                  <Button key={c.id} onClick={() => open(c)}>
                    {c.title}
                  </Button>
                ))}
            </Space>
          )}
        </Modal>
      )}
    </div>
  );
}
