import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Carousel, Segmented, Space, Spin, message } from 'antd';
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

function Photo({ card, external = false }: { card: Card; external?: boolean }) {
  const source = card.imageUrl || (card.image && assetUrl(card, card.image, external));
  const [loaded, setLoaded] = useState<{ source: string; url: string }>();
  useEffect(() => {
    if (!source || external || inPreviewFrame) return;
    let url = '';
    const controller = new AbortController();
    void authenticatedFetch(source, controller.signal)
      .then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(blob);
          setLoaded({ source, url });
        }
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, external]);
  const src = external ? source : loaded?.source === source ? loaded?.url : undefined;
  return src ? (
    <img className="portal-photo" src={src} alt={card.caption || card.personName || card.title} />
  ) : (
    <div className="portal-monogram" aria-hidden="true">
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
        {[labels[card.kind], card.subtitle, card.period, card.date?.slice(0, 10)].filter(Boolean).join(' · ')}
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

function Slider({ cards, external, open }: { cards: Card[]; external: boolean; open: (c: Card) => void }) {
  const slider = useRef<CarouselRef>(null);
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [index, setIndex] = useState(0);
  if (!cards.length) return <p className="portal-empty">暂无展示资料</p>;
  return (
    <div className="portal-slider">
      <Carousel
        ref={slider}
        dots={false}
        autoplay={!paused && cards.length > 1}
        autoplaySpeed={6500}
        pauseOnFocus
        pauseOnHover
        draggable
        waitForAnimate={false}
        afterChange={setIndex}
      >
        {cards.map((c) => (
          <div key={c.id}>
            <button className="portal-person" onClick={() => open(c)}>
              <Photo card={c} external={external} />
              <span>
                <strong>{c.title}</strong>
                <small>{[c.period, c.subtitle].filter(Boolean).join(' · ')}</small>
                <span className="portal-excerpt">{c.body}</span>
              </span>
            </button>
          </div>
        ))}
      </Carousel>
      {cards.length > 1 && (
        <div className="portal-controls">
          <span>
            {index + 1} / {cards.length}
          </span>
          <Button size="small" aria-label="上一位" onClick={() => slider.current?.prev()}>
            ←
          </Button>
          <Button size="small" onClick={() => setPaused(!paused)}>
            {paused ? '播放' : '暂停'}
          </Button>
          <Button size="small" aria-label="下一位" onClick={() => slider.current?.next()}>
            →
          </Button>
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
          profile?.body,
          p.directions.length ? '专业方向 · ' + p.directions.join('、') : '',
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
  const admin = useAuthStore((s) => s.authorization?.isSystemSuperAdmin);
  const [feed, setFeed] = useState<Feed>(),
    [error, setError] = useState(''),
    [retry, refresh] = useState(0);
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<{ title: string; cards: Card[] }>(),
    [category, switchTo] = useState('律师');
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
      <Alert type="error" title={error} action={<Button onClick={() => refresh(retry + 1)}>重试</Button>} />
    );
  if (!feed) return <Spin aria-label="加载承业首页" />;
  const by = (kind: Kind) => feed.entries.filter((c) => c.kind === kind);
  const { lawyers, teams } = directory(feed);
  const people = external ? by('LAWYER') : lawyers,
    groups = external ? by('TEAM') : teams;
  const honors = by('HONOR').map((c) => ({ ...c, subtitle: c.title, title: c.personName }));
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
  const showAll = (title: string, cards: Card[]) => setList({ title, cards });
  function panel(kind: Kind, limit: number) {
    const cards = by(kind);
    if (external && !cards.length) return null;
    return (
      <section className={'portal-panel portal-section-' + kind.toLowerCase()}>
        <header>
          <h2>{labels[kind]}</h2>
          {cards.length > limit && <button onClick={() => showAll(labels[kind], cards)}>查看全部</button>}
        </header>
        {cards.slice(0, limit).map((c) => (
          <div className="portal-list-row" key={c.id}>
            {kind === 'NEWS' && c.image && (
              <div className="portal-thumb">
                <Photo card={c} external={external} />
              </div>
            )}
            <button className="portal-row-title" onClick={() => open(c)}>
              {c.pinned && <small>置顶 </small>}
              {c.title}
              <small>
                {kind === 'DOWNLOAD' ? (c.file?.name ?? '') + ' · v' + c.number : c.date?.slice(0, 10)}
              </small>
            </button>
            {kind === 'DOWNLOAD' && <FileActions card={c} />}
          </div>
        ))}
        {!cards.length && <p className="portal-empty">暂无已发布{kind === 'DOWNLOAD' ? '文件' : '内容'}</p>}
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
              <button onClick={() => (about.length === 1 ? open(about[0]) : showAll('了解承业', about))}>
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
            <Slider cards={honors} external={false} open={open} />
          </section>
        )}
        {panel('CASE', 4)}
      </div>
      {by('CONTACT').map((contact) => (
        <footer className="portal-contact" key={contact.id}>
          <div>
            <h2>{contact.title || '联系我们'}</h2>
            <div className="portal-prose">{contact.body}</div>
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
          {list.cards.length === 0 && <p>暂无展示资料</p>}
          {list.cards.map((c) => (
            <button className="portal-choice" key={c.id} onClick={() => open(c)}>
              {c.title}
              {c.personName && c.personName !== c.title ? ' · ' + c.personName : ''}
            </button>
          ))}
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
