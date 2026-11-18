> 2026-11-06：本文保留部署及历史运行门禁。当前功能/数据模型见 [CURRENT_SPEC](CURRENT_SPEC.md)；用户功能人工验收不等同于生产恢复、独立安装器或外部服务验收。已有库部署按完整迁移目录检查，不重跑初始化或清空业务。

# Deployment

Deploy with Node 22, npm, PostgreSQL 16, and an externally managed `DATABASE_URL`.

## Release Sequence

```powershell
npm.cmd run setup
npm.cmd run db:deploy
npm.cmd run verify
```

For the first deployment to a new database, take and verify a production backup or restore point before initialization, then run:

```powershell
npm.cmd run db:deploy
npm.cmd run db:assert-empty
npm.cmd run system:bootstrap
```

`npm.cmd run setup` installs the root, server, and web lockfiles and generates Prisma Client for a clean checkout.

Set runtime secrets and the database URL through the deployment environment, never through committed files. Apply canonical migrations before starting the application. `db:assert-empty` is a first-initialization safety check and must not be run as an emptiness expectation after the system has been initialized. Enter the temporary password only through hidden interactive prompts and complete the first-login forced-change procedure in `../../../docs/superpowers/runbooks/system-bootstrap-and-super-admin-recovery.md`.

Use the protected `db:reset:test` command only for test databases. Use the backup and restore rehearsal in `../../../docs/superpowers/runbooks/postgresql-backup-restore.md` for recovery validation. Deployment rollback must use PostgreSQL backups and reviewed migration procedures.

## Windows Distribution

`npm.cmd run pkg` is the only portable distribution producer. It builds the web and server applications from fresh output directories and writes the verified runtime tree to `apps/dist/law-firm-system/`. The tree contains `law-firm-system.exe` plus physical `prisma-engine/`, `public/`, and `run/` directories.

Run `npm.cmd run build:zip` to rebuild that tree and create `apps/dist/installer/LawFirmSystem-Portable-1.0.0.zip`. Run `npm.cmd run build:installer` with Inno Setup 6 `iscc` on `PATH` to rebuild the same tree and create the installer. Both distribution commands reject incomplete runtime trees before consuming them.

Configure `DATABASE_URL`, `JWT_SECRET`, `APP_KEYS`, `CORS_ALLOWED_ORIGINS`, and `MFA_ENCRYPTION_KEY_V1` in the launch environment. `MFA_ENCRYPTION_KEY_V1` must be canonical Base64 for exactly 32 random bytes and must be restored with the database that contains its encrypted factors. Start the portable or installed application with `law-firm-system.exe`.

Identity-security releases require synchronized server/web deployment and invalidation of legacy sessions. Follow `../../../docs/superpowers/runbooks/identity-security-mfa-step-up.md` for the key lifecycle, two-super-admin enrollment, governed/CLI reset, key-loss response, and rollback.

## Event Worker Canary

Event-center releases use an additive migration and start with `EVENT_WORKER_ENABLED=false`. Run the source `events:check -- --mode=preflight` command before and after one controlled `events:drain`; the second drain must claim no work. The portable equivalents are `law-firm-system.exe events:check --mode=preflight` and `law-firm-system.exe events:drain`.

Enable one Worker instance, restart it through the normal deployment mechanism, and observe `events:check -- --mode=canary` for the complete configured window (15 minutes by default). `READY` permits completion, `DEGRADED` extends observation and requires investigation, and `BLOCKED` requires immediate rollback. Rollback sets `EVENT_WORKER_ENABLED=false`, confirms `DISABLED` and no new claims, and preserves all event, delivery, HandlerLog, notification idempotency, and audit evidence.

The guarded local rehearsal is `npm.cmd --prefix apps/server run rehearse:event-observability`. It additionally requires the exact resettable localhost test target, the reset guard, and the dedicated event-observability rehearsal guard. It rejects target aliases and URL differences before connecting, performs only dependency injection for the availability drill, and always cleans its fixture in `finally`. Do not use it against a production database. Full operating steps and source/portable commands are in `../../../docs/superpowers/runbooks/reliable-event-center-outbox.md`.

## 承业空间文件预览

Word、Excel 和 PowerPoint 的新旧格式由 OA API 在本机转为临时 PDF。Linux API 主机需要安装 LibreOffice Writer、Calc、Impress、中文字体、Bubblewrap 和 util-linux，并允许服务账号使用 Bubblewrap 创建隔离命名空间。默认安装目录为 `/usr/lib/libreoffice`，便携安装可将 API 环境变量 `OA_PREVIEW_OFFICE_ROOT` 指向包含 `program/soffice` 的目录。发布后可用含中文的 DOCX、XLSX、PPTX 在“我的资源”点“预览”验证转换与字体。

单次 Office 预览支持 64 MiB 以内的原件；PDF 和图片支持 128 MiB，文本、HTML 和 Markdown 支持 4 MiB。预览按内容版本读取，每次检查原有文件权限。转换产生的 PDF 临时文件在请求处理后清理。

如果 Linux 服务账号无法创建 Bubblewrap 命名空间，可为 API 配置本地 WebAssembly 转换器。使用 Node 22.19 或更高版本，在独立工具目录安装 `@deepseek-ai/libreoffice-kit@0.2.3` 和 `@deepseek-ai/libreoffice-kit-wasm@0.2.3`，将 `OA_PREVIEW_WASM_CLI` 设为该目录下 `node_modules/@deepseek-ai/libreoffice-kit/lib/cli.js` 的绝对路径。此模式支持 DOC、DOCX、XLS、XLSX、PPT、PPTX 及 ODF。
