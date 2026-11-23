import { Prisma, PrismaClient } from '@prisma/client';
import { extname } from 'node:path';
import { MasterDataError } from '../../domain/master-data/master-data-errors';

const kinds = [
  'CONTACT',
  'INTRO',
  'CULTURE',
  'HISTORY',
  'NOTICE',
  'NEWS',
  'DOWNLOAD',
  'LAWYER',
  'TEAM',
  'HONOR',
  'CASE',
];
const publicKinds = ['CONTACT', 'INTRO', 'CULTURE', 'HISTORY', 'NEWS', 'LAWYER', 'TEAM', 'CASE'];
const lawyerTypes = ['PARTNER', 'LAWYER', 'SENIOR_LAWYER', 'JUNIOR_LAWYER'];
const active: Prisma.EmployeeWhereInput = {
  deletedAt: null,
  status: { in: ['PROBATION', 'FORMAL'] },
  user: { status: 'ENABLED' },
};
const teamActive: Prisma.ProfessionalTeamWhereInput = { status: 'ENABLED', deletedAt: null };
const assets = {
  image: { select: { id: true, name: true } },
  file: { select: { id: true, name: true } },
} as const;
type Db = Prisma.TransactionClient;
type Input = Record<string, unknown>;
function fail(message: string, status = 400): never {
  throw new MasterDataError(message, status);
}
function field(value: unknown, max: number) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) fail('内容格式或长度不正确');
  return value.trim();
}
function integer(value: unknown, max: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    fail('序号或版本无效');
  return value;
}

async function attachment(tx: Db, value: unknown, original: string | null, image: boolean) {
  if (value === undefined) return original;
  if (value === null) return null;
  if (typeof value !== 'object') fail('附件格式错误');
  const { name, data } = value as Input;
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 200 ||
    name.includes('/') ||
    name.includes('\\') ||
    Array.from(name).some((char) => char.charCodeAt(0) < 32) ||
    typeof data !== 'string' ||
    data.length > 14 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    fail('附件格式错误');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 10 * 1024 * 1024 || !bytes.length) fail('附件大小须在 10 MB 以内');
  let mime = 'application/octet-stream';
  if (image) {
    if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) mime = 'image/png';
    else if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) mime = 'image/jpeg';
    else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
      mime = 'image/webp';
    else fail('图片仅支持 PNG、JPEG 或 WebP');
  } else if (
    !['.doc', '.docx', '.xlsx', '.xls', '.ppt', '.pptx', '.pdf', '.md', '.txt'].includes(
      extname(name).toLowerCase(),
    )
  ) {
    fail('请选择 Office、PDF、Markdown 或文本文件');
  }
  return (await tx.portalAsset.create({ data: { name, mime, bytes }, select: { id: true } })).id;
}

export async function portalDirectory(db: Db) {
  const now = new Date();
  const effective = { startedAt: { lte: now }, OR: [{ endedAt: null }, { endedAt: { gt: now } }] };
  const [people, teams] = await Promise.all([
    db.employee.findMany({
      where: active,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        type: true,
        professionalDirections: true,
        assignments: { where: effective, select: { position: { select: { name: true } } } },
        professionalTeams: {
          where: { ...effective, professionalTeam: teamActive },
          select: { professionalTeamId: true },
        },
      },
    }),
    db.professionalTeam.findMany({
      where: teamActive,
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  return {
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      lawyer: lawyerTypes.includes(p.type),
      directions: p.professionalDirections,
      positions: p.assignments.map((a) => a.position.name),
      teams: p.professionalTeams.map((t) => t.professionalTeamId),
    })),
    teams,
  };
}

async function subjectName(db: Db, kind: string, subject: string | null) {
  if (kind === 'TEAM')
    return (
      await db.professionalTeam.findFirst({
        where: { id: subject ?? '', ...teamActive },
        select: { name: true },
      })
    )?.name;
  if (kind === 'LAWYER' || kind === 'HONOR')
    return (
      await db.employee.findFirst({
        where: {
          id: subject ?? '',
          ...active,
          ...(kind === 'LAWYER' ? { type: { in: lawyerTypes } } : {}),
        },
        select: { name: true },
      })
    )?.name;
  return '';
}

export async function saveDraft(db: PrismaClient, editorId: string, id: string | undefined, input: Input) {
  const kind = field(input.kind, 20),
    subject = field(input.subject, 80) || null;
  if (!kinds.includes(kind)) fail('栏目无效');
  const linked = ['LAWYER', 'TEAM', 'HONOR'].includes(kind);
  if (linked !== Boolean(subject)) fail('请选择对应的员工或团队');
  const title = field(input.title, 160),
    body = field(input.body, 80000),
    caption = field(input.caption, 400),
    period = field(input.period, 60);
  const priority = integer(input.priority ?? 0, 9999);
  const external = input.external === true,
    pinned = input.pinned === true && kind === 'NOTICE';
  if (external && !publicKinds.includes(kind)) fail('此栏目仅限所内展示');
  const expiry = field(input.expiresAt, 60);
  const expiresAt = expiry && kind === 'NOTICE' ? new Date(expiry) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) fail('公告到期时间无效');
  if (kind === 'HONOR' && !period) fail('请填写评选期间');
  const version = integer(input.version ?? 0, 2147483646);
  try {
    return await db.$transaction(async (tx) => {
      const name = await subjectName(tx, kind, subject);
      if (name === undefined) fail('关联人员或团队已不可用');
      if (!title && !name) fail('请填写标题');
      const last = id
        ? await tx.portalEntry.findUnique({
            where: { id },
            include: { revisions: { take: 1, orderBy: { number: 'desc' } } },
          })
        : null;
      if (id && (!last || last.kind !== kind || last.subject !== subject)) fail('栏目或关联对象不匹配', 409);
      if (last) await claim(tx, last.id, version);
      const entryId =
        last?.id ??
        (
          await tx.portalEntry.create({
            data: {
              kind,
              subject,
              slot: ['INTRO', 'CONTACT'].includes(kind)
                ? kind
                : ['TEAM', 'LAWYER'].includes(kind)
                  ? kind + '/' + subject
                  : null,
            },
          })
        ).id;
      const prev = last?.revisions[0];
      const portrait =
        kind === 'HONOR' && !prev && input.image === undefined
          ? await tx.portalEntry.findUnique({
              where: { slot: 'LAWYER/' + subject },
              select: { published: { select: { imageId: true } } },
            })
          : undefined;
      const imageId = await attachment(
        tx,
        input.image,
        prev?.imageId ?? portrait?.published?.imageId ?? null,
        true,
      );
      const fileId =
        kind === 'DOWNLOAD' ? await attachment(tx, input.file, prev?.fileId ?? null, false) : null;
      const revision = await tx.portalRevision.create({
        data: {
          entryId,
          number: (prev?.number ?? 0) + 1,
          title: title || name!,
          personName: name ?? '',
          body,
          caption,
          period,
          priority,
          pinned,
          external,
          expiresAt,
          imageId,
          fileId,
          editorId,
        },
        select: { id: true },
      });
      return { id: entryId, revisionId: revision.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      fail('此栏目已有内容，请打开原条目编辑', 409);
    throw e;
  }
}

async function claim(tx: Db, id: string, version: number) {
  const changed = await tx.portalEntry.updateMany({
    where: { id, version, deletedAt: null },
    data: { version: { increment: 1 } },
  });
  if (!changed.count) fail('内容已更新，请刷新后重试', 409);
}

export async function publishPortal(
  db: PrismaClient,
  id: string,
  version: number,
  publish: boolean,
  actor: string,
) {
  integer(version, 2147483646);
  return db.$transaction(async (tx) => {
    await claim(tx, id, version);
    const item = await tx.portalEntry.findUniqueOrThrow({
      where: { id },
      include: { revisions: { orderBy: { number: 'desc' }, take: 1 } },
    });
    const rev = item.revisions[0];
    if (publish) {
      if ((await subjectName(tx, item.kind, item.subject)) === undefined) fail('关联人员或团队已不可用');
      if (item.kind === 'DOWNLOAD' && !rev.fileId) fail('发布前请上传下载文件');
      if (rev.expiresAt && rev.expiresAt <= new Date()) fail('公告到期时间已过');
    }
    await tx.portalEntry.update({
      where: { id },
      data: { publishedId: publish ? rev.id : null, publishedAt: publish ? new Date() : null },
    });
    await tx.operationLog.create({
      data: {
        userId: actor,
        action: publish ? 'PUBLISH' : 'UNPUBLISH',
        targetType: 'PORTAL',
        targetId: id,
        newValues: JSON.stringify({ number: rev.number, external: publish && rev.external }),
      },
    });
  });
}

export async function manageList(db: Db) {
  const [entries, directory] = await Promise.all([
    db.portalEntry.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        revisions: { take: 1, orderBy: { number: 'desc' }, include: assets },
        published: { select: { number: true } },
      },
    }),
    portalDirectory(db),
  ]);
  return {
    entries: entries.map(({ revisions, published, ...item }) => ({
      ...item,
      draft: revisions[0],
      liveVersion: published?.number ?? null,
    })),
    ...directory,
  };
}

type Revision = Prisma.PortalRevisionGetPayload<{ include: typeof assets }>;
function display(r: Revision) {
  return {
    title: r.title,
    body: r.body,
    caption: r.caption,
    period: r.period,
    personName: r.personName,
    number: r.number,
    priority: r.priority,
    pinned: r.pinned,
    image: r.image,
    file: r.file,
  };
}
function liveWhere(external: boolean): Prisma.PortalEntryWhereInput {
  return {
    deletedAt: null,
    ...(external ? { kind: { in: publicKinds } } : {}),
    published: {
      is: {
        ...(external ? { external: true } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    },
  };
}
type FeedItem = ReturnType<typeof display> & {
  id: string;
  kind: string;
  date: Date | null;
  subject: string | null;
};
type Feed = Awaited<ReturnType<typeof portalDirectory>> & { entries: FeedItem[] };
export async function portalFeed(db: Db, external: boolean): Promise<Feed> {
  const items = await db.portalEntry.findMany({
    where: liveWhere(external),
    include: { published: { include: assets } },
    orderBy: { publishedAt: 'desc' },
  });
  if (external) {
    const subjects = (kind: string) =>
      items.filter((i) => i.kind === kind && i.subject).map((i) => i.subject!);
    const [lawyers, teams] = await Promise.all([
      db.employee.findMany({
        where: { ...active, id: { in: subjects('LAWYER') }, type: { in: lawyerTypes } },
        select: { id: true },
      }),
      db.professionalTeam.findMany({
        where: { ...teamActive, id: { in: subjects('TEAM') } },
        select: { id: true },
      }),
    ]);
    const entries = items
      .filter(
        (i) =>
          (i.kind !== 'LAWYER' || lawyers.some((p) => p.id === i.subject)) &&
          (i.kind !== 'TEAM' || teams.some((t) => t.id === i.subject)),
      )
      .map(
        (i): FeedItem => ({
          id: i.id,
          kind: i.kind,
          date: i.publishedAt,
          ...display(i.published!),
          image: i.published!.image
            ? { id: i.published!.image.id, name: i.published!.caption || i.published!.title }
            : null,
          subject: null,
          file: null,
        }),
      )
      .sort((a, b) => b.priority - a.priority);
    return { entries, people: [], teams: [] };
  }
  const directory = await portalDirectory(db);
  const people = new Map(directory.people.map((p) => [p.id, p])),
    teams = new Map(directory.teams.map((t) => [t.id, t]));
  const entries = items
    .flatMap((item) => {
      const person = people.get(item.subject ?? ''),
        team = teams.get(item.subject ?? '');
      if (
        (item.kind === 'LAWYER' && !person?.lawyer) ||
        (item.kind === 'TEAM' && !team) ||
        (item.kind === 'HONOR' && !person) ||
        !item.published
      )
        return [];
      return [
        {
          id: item.id,
          kind: item.kind,
          subject: item.subject,
          date: item.publishedAt,
          ...display(item.published),
          ...(person ? { personName: person.name } : {}),
          ...(item.kind === 'LAWYER' || item.kind === 'TEAM'
            ? { title: item.kind === 'TEAM' ? team!.name : person!.name }
            : {}),
        },
      ];
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.priority - a.priority);
  return {
    entries,
    people: directory.people.filter((p) => p.lawyer || p.teams.length),
    teams: directory.teams,
  };
}

export async function readAsset(
  db: Db,
  id: string,
  assetId: string,
  external: boolean,
  draftNumber?: number,
) {
  const entry = await db.portalEntry.findFirst({
    where: { id, deletedAt: null, ...(draftNumber ? {} : liveWhere(external)) },
    include: {
      published: { select: { imageId: true, fileId: true } },
      revisions: { where: { number: draftNumber ?? -1 }, select: { imageId: true, fileId: true } },
    },
  });
  const rev = draftNumber ? entry?.revisions[0] : entry?.published;
  if (!entry || !rev || !(rev.imageId === assetId || (!external && rev.fileId === assetId)))
    fail('资料未发布或已下架', 404);
  if (
    !draftNumber &&
    ['TEAM', 'LAWYER', 'HONOR'].includes(entry.kind) &&
    (await subjectName(db, entry.kind, entry.subject)) === undefined
  )
    fail('资料已下架', 404);
  return db.portalAsset.findUniqueOrThrow({ where: { id: assetId } });
}

export async function deletePortal(db: PrismaClient, id: string, version: number, actor: string) {
  integer(version, 2147483646);
  return db.$transaction(async (tx) => {
    await claim(tx, id, version);
    const item = await tx.portalEntry.findUniqueOrThrow({ where: { id } });
    if (item.publishedId) fail('请先下架这条内容，再删除', 409);
    await tx.portalEntry.update({ where: { id }, data: { deletedAt: new Date(), slot: null } });
    await tx.operationLog.create({
      data: {
        userId: actor,
        action: 'DELETE',
        targetType: 'PORTAL',
        targetId: id,
        newValues: JSON.stringify({ kind: item.kind }),
      },
    });
  });
}
