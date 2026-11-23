export const labels = {
  INTRO: '承业简介',
  CULTURE: '律所文化',
  HISTORY: '发展历程',
  NOTICE: '通知公告',
  NEWS: '承业新闻',
  DOWNLOAD: '下载中心',
  LAWYER: '律师风采',
  TEAM: '专业团队',
  HONOR: '优秀员工',
  CASE: '优秀案例',
};
export type Kind = keyof typeof labels;
export const publicKinds: Kind[] = ['INTRO', 'CULTURE', 'HISTORY', 'NEWS', 'LAWYER', 'TEAM', 'CASE'];
export type Asset = { id: string; name: string };
export type Revision = {
  number: number;
  title: string;
  body: string;
  caption: string;
  period: string;
  personName: string;
  priority: number;
  pinned: boolean;
  image: Asset | null;
  file: Asset | null;
};
export type Draft = Revision & { external: boolean; expiresAt: string | null; createdAt: string; id: string };
export type Card = Revision & {
  id: string;
  kind: Kind;
  subject: string | null;
  date: string | null;
  subtitle?: string;
  imageUrl?: string;
  fileUrl?: string;
};
export type Person = {
  id: string;
  name: string;
  lawyer: boolean;
  type: string;
  directions: string[];
  positions: string[];
  teams: string[];
};
export type Team = { id: string; name: string; description: string | null };
export type Directory = { people: Person[]; teams: Team[] };
export type Feed = Directory & { entries: Card[] };
export type Item = {
  id: string;
  kind: Kind;
  subject: string | null;
  draft: Draft;
  version: number;
  publishedId: string | null;
  liveVersion: number | null;
};
export type AdminFeed = Directory & { entries: Item[] };
export const blank = {
  number: 0,
  title: '',
  body: '',
  caption: '',
  period: '',
  personName: '',
  priority: 0,
  pinned: false,
  image: null,
  file: null,
};
export function assetUrl(card: Card, asset: Asset, external = false) {
  return external
    ? '/api/v1/showcase/photo?id=' + encodeURIComponent(card.id) + '&asset=' + encodeURIComponent(asset.id)
    : '/api/v1/portal/files/' + encodeURIComponent(card.id) + '/' + encodeURIComponent(asset.id);
}
export function portalError(e: unknown) {
  const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return msg && /[\u4e00-\u9fff]/.test(msg)
    ? msg
    : e instanceof Error && /[\u4e00-\u9fff]/.test(e.message)
      ? e.message
      : '请求未完成，请刷新后重试。';
}
