import type { Context } from 'egg';
import { execFile } from 'node:child_process';
import { constants, createReadStream } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fail } from '../collaboration/collaboration-policy';

const run = promisify(execFile);
const MiB = 1024 * 1024;
const office = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf']);
const formats: Record<string, string> = {
  pdf: 'pdf', txt: 'text', csv: 'text', log: 'text', json: 'text', md: 'markdown', markdown: 'markdown',
  htm: 'html', html: 'html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
};
let conversions = 0;

// Only the selected input is mounted. Keep the Office profile, auxiliary files and network private.
async function officePdf(source: string | Buffer, extension: string) {
  const installation = process.env.OA_PREVIEW_OFFICE_ROOT || '/usr/lib/libreoffice';
  try { await Promise.all(['/usr/bin/bwrap', path.join(installation, 'program/soffice')].map(file => access(file, constants.X_OK))); }
  catch { fail('FILE_PREVIEW_CONVERTER_UNAVAILABLE', 503); }
  if (conversions >= 2) fail('FILE_PREVIEW_BUSY', 429);
  conversions++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'oa-file-preview-'));
    const input = typeof source === 'string' ? source : path.join(directory, 'input');
    if (Buffer.isBuffer(source)) await writeFile(input, source, { mode: 0o600 });
    // Mount only an empty output file writable, never a host directory.
    const output = path.join(directory, 'preview.pdf');
    await writeFile(output, '', { mode: 0o600 });
    const document = '/input/document.' + extension;
    // LibreOffice saves by rename, so export in tmpfs and copy the completed PDF to the single writable mount.
    await run('/usr/bin/bwrap', [
      '--unshare-all', '--die-with-parent', '--new-session', '--clearenv',
      '--ro-bind', '/usr/bin', '/usr/bin', '--ro-bind', '/usr/lib', '/usr/lib', '--ro-bind-try', '/usr/lib64', '/usr/lib64',
      '--ro-bind', '/usr/share', '/usr/share', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
      '--symlink', 'usr/lib64', '/lib64', '--ro-bind-try', '/etc/fonts', '/etc/fonts',
      '--ro-bind-try', '/etc/libreoffice', '/etc/libreoffice', '--ro-bind', installation, '/office',
      '--proc', '/proc', '--dev', '/dev', '--size', String(384 * MiB), '--tmpfs', '/tmp',
      '--ro-bind', input, document, '--bind', output, '/result.pdf', '--chdir', '/tmp',
      '--setenv', 'PATH', '/usr/bin', '--setenv', 'HOME', '/tmp', '--setenv', 'LANG', 'C.UTF-8',
      '--setenv', 'SAL_USE_VCLPLUGIN', 'svp', '--setenv', 'MALLOC_ARENA_MAX', '2',
      '--setenv', 'MAX_CONCURRENCY', '2', '--',
      '/usr/bin/prlimit', '--as=5368709120', '--cpu=45', '--fsize=' + (128 * MiB), '--',
      '/bin/sh', '-ec', '/office/program/soffice -env:UserInstallation=file:///tmp/profile --headless --norestore --convert-to pdf --outdir /tmp "$1"; test -s /tmp/document.pdf; cat /tmp/document.pdf > /result.pdf',
      'preview', document,
    ], { timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024 });
    const pdf = await readFile(output);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid conversion');
    return pdf;
  } catch { return fail('FILE_PREVIEW_CONVERSION_FAILED', 422); }
  finally {
    conversions--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

/** Call only after the normal file/version access check. Source paths are resolved by the storage service. */
export async function servePreview(ctx: Context, name: string, source: string | Buffer) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const convert = office.has(ext);
  const format = convert ? 'pdf' : Object.hasOwn(formats, ext) ? formats[ext] : undefined;
  if (!format) fail('FILE_PREVIEW_UNSUPPORTED', 415);
  const size = typeof source === 'string' ? (await stat(source)).size : source.length;
  const limit = ['text', 'html', 'markdown'].includes(format) ? 4 : convert ? 64 : 128;
  if (size > limit * MiB) fail('FILE_PREVIEW_TOO_LARGE', 413);
  const body = convert ? await officePdf(source, ext) : typeof source === 'string' ? createReadStream(source) : source;
  ctx.set('Cache-Control', 'private, no-store');
  ctx.set('X-Content-Type-Options', 'nosniff');
  ctx.set('X-OA-Preview', format);
  ctx.attachment(convert ? path.parse(name).name + '.pdf' : name);
  ctx.type = 'application/octet-stream';
  ctx.body = body;
}
