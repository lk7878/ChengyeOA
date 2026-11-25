# OA 智慧办案集成运维说明

本版本以独立 case-service、WeKnora Lite 和按任务启动的 Harness 替换 OA 旧智能模块。OA 是身份、案件及正式文件权威来源。部署为单个写入实例；不得同时启动两个 case-service 指向同一数据目录。

## 当前目录与端口

- OA：`/opt/oa-system/app/ChengyeOA/LayerManage/law-firm-system`，前端 3000，后端 7001。
- 本项目：`/home/ubuntu/文档/likui/智慧办案-20261114`。
- 工作台生产静态入口：`http://127.0.0.1:5180`，流式转发 API 和 WebSocket 至 5181。
- case-service：127.0.0.1:5181。WeKnora：127.0.0.1:8093。两者不直接对公网开放。
- Harness 每任务独立进程、临时端口和 Unix socket，不发布固定共享 Harness 端口。
- 本机访问从 OA `/smart-case` 开始，不能直接访问私人任务后绕过 OA。

当前云网关 `162.14.78.238` 的 SSH 要求微信扫码验证；没有切换云配置，也没有覆盖其现有业务。当前外网 OA 用户会得到“外网入口尚未配置”提示。本机可运行不等于公网切换已完成。需要有权的网关操作者配置独立 HTTPS 域名后，按下节切换。

## 配置与启动

Node 22 供 OA/case-service，Node 24.22.1 供 Harness，Go 1.26.0 供 WeKnora 构建。当前 Ubuntu 的 bubblewrap 已验证可使用非特权用户命名空间。不得去掉隔离参数或将整个用户/服务器目录挂入任务。

私密配置位于 `data/integration/service.env`，权限 0600：

```dotenv
OA_API_BASE=http://127.0.0.1:7001
OA_PUBLIC_URL=http://127.0.0.1:3000
WORKBENCH_PUBLIC_BASE=http://127.0.0.1:5180
SMART_CASE_PUBLIC_URL=http://127.0.0.1:5180
SMART_CASE_CLIENT_SECRET=<至少32字符的随机值>
WEKNORA_BASE=http://127.0.0.1:8093
WEKNORA_API_KEY=<后端知识服务凭据>
COOKIE_SECURE=0
```

`SMART_CASE_CLIENT_SECRET` 必须与 OA `apps/server/.env` 一致。`configure-host.mjs` 只同步这两个集成变量并初始化目标库的超级管理员审核名单。普通管理员、同部门或同角色不自动获得私人资料或知识库权限。

模型配置仍读取原项目 `.dsh/settings.yaml` 和 `.dsh/.env`。`CHAT_BASE_URL/CHAT_API_KEY/CHAT_MODEL` 与 `OCR_BASE_URL/OCR_API_KEY/OCR_MODEL` 可分别覆盖；未覆盖时沿用既有主模型配置。WeKnora 的解析、向量化配置继续由其私有 `.env.lite` 和配置目录管理。真实密钥只在后端代理使用，任务只得到占位凭据。

```bash
source /opt/oa-system/toolchain/env.sh
cd '/home/ubuntu/文档/likui/智慧办案-20261114'
python3 deploy/integration/prepare-runtime.py
npm --prefix work_ui run build
python3 deploy/integration/install-services.py
systemctl --user start oa-smart-knowledge oa-smart-case oa-smart-workbench
curl http://127.0.0.1:5180/api/health
```

已启用用户级 systemd 服务和用户 linger。`oa-main.service` 接管原有 OA 后端开发运行方式；没有把现有 OA 部署伪称为完整生产加固。OA 数据库启动仍沿用 `/opt/oa-system/runtime/postgres/start.sh`。重启整机时先确认 PostgreSQL 55432 正常，再检查 OA 和三个集成服务。

```bash
systemctl --user status oa-main oa-smart-knowledge oa-smart-case oa-smart-workbench
journalctl --user -u oa-smart-case -n 100
systemctl --user restart oa-smart-case
```

case-service 重启时运行中任务标为中断，已保存文件及任务会话留存。用户重新启动任务后创建新的当前会话，旧会话仍在该任务专属运行目录内。不要声称重启会继续正在生成的一轮模型调用。

## HTTPS 网关切换

将独立域名整站转发到 5180，保留 WebSocket Upgrade，并允许至少 4 MiB 的单个分片请求。不要公开 5181、8093 或任务临时端口。静态入口自身对文件请求采用流转发；没有固定整文件大小上限。

把 `OA_PUBLIC_URL` 改为实际 OA 地址，把 `WORKBENCH_PUBLIC_BASE/SMART_CASE_PUBLIC_URL` 改为工作台 HTTPS 地址，`COOKIE_SECURE=1`。同步 OA 的集成 URL，重启 OA 与 case-service。不能沿用原共享 Harness/WeKnora 裸入口作为新登录方式。正式证书、域名和云防火墙配置需要网关操作者完成。

## 来源与重建

`upstream-lock.json` 固定 Harness 及法律技能源提交。Harness 实施时再次核对上游 HEAD 为 `39163dd30f703a79079e2d2446545cff3c453738`，通过 `build:artifacts` 的 8 个构建检查。实际依赖安装工具为 pnpm 11.25.0；上游 packageManager 声明为 11.28.5，两者明确区分。不要启动时自动更新上游。

- Harness 放在 `runtime/upstream/harness`，Node 24 完整目录放在 `runtime/node24`。
- 额外 Node 插件依赖由 `plugin-dependencies.json` 和对应 lock 安装到 `runtime/plugin-deps`。
- Python 依赖按 `python-requirements.txt` 安装到 `runtime/python-deps`；使用 Python 3。
- `prepare-runtime.py` 生成 `runtime/bundle`，将 Windows 路径改为只读 `/app`，适配最新插件与提示词接口。
- WeKnora 提供时的 Git 基线为 `1ef38fdb8b19347b82d3a99f6f17d75ac09ad606`。`weknora-patches/frontend-current.patch` 包含提供时前端品牌增量和本次 OA 集成/依赖修复；`weknora-assets` 复制到源码对应路径。没有重置原独立仓库的未提交内容。
- WeKnora 用 `go build -tags sqlite_fts5 -ldflags '-w -s -X github.com/Tencent/WeKnora/internal/handler.Edition=lite' -o ../runtime/weknora-lite ./cmd/server` 构建，前端 `npm ci && npm run build -- --base /knowledge-native/`。补丁已在原 HEAD 干净副本中应用验证，先 `git apply /路径/frontend-current.patch` 再复制 assets。当前无 root 环境使用解包的 SQLite 3.45.1 开发文件设置 CGO include/library 路径。
- 运行二进制、依赖目录、数据和凭据不进入 Git。重新安装时需恢复私密配置和运行数据，不能仅凭源码假设已包含模型或知识数据库。

## 知识管理

超级管理员在“设置→知识库授权”按用户分配读者及审核者。审核者还必须拥有 OA `knowledge.review` 动作权限。普通用户只能看到已发布且目标库允许的检索结果。

532 份提供时的知识 Markdown 保留在 `konwledge-md`，按原路径和哈希整理为 4 份待审汇编。`stage-existing-knowledge.mjs` 必须在 case-service 停止时执行，按内容哈希幂等。没有自动认定其法规现行有效或案例已脱敏；审核通过、索引完成后才能发布。

投稿审核、知识导入、索引和发布是不同状态。索引失败不会显示发布成功，可以重试。原生页面支持授权库查看、分块、原文下载、重新解析与删除；知识正文的新增和修改需通过工作台的固定快照审核，不直接绕过发布门禁。原生重新解析先撤掉检索可见性，审核员检查索引后再发布。

## 文件、成果和权限

所有新上传使用 4 MiB 分片、偏移量与哈希校验、可恢复 uploadId。整文件不受 10 MB/200 MB 业务阈值限制；容量受可用磁盘约束。旧内容版本不可覆盖。上传已保存、解析完成及模型可读性分别说明，不能把“材料准备完成”当作“解析完成”。

任务仅复制被选择的具体版本至 materials。模型可写 drafts/reports；文件稳定后自动分片写入 OA 个人空间，OA 确认后才标已保存。失败保留待保存成果。共享材料及衍生成果的发布权限递归核验。正式案件归档另行确认并实时检查权限、案件状态及幂等键。

全员文件管理是超级管理员专用的只读审计入口，不授予私人会话访问。新系统不提供第二套账号密码管理。撤权、停号和退出影响 API、工具、WebSocket 及运行进程；已经读入历史输出的信息无法保证自动撤回。

## 备份与恢复

```bash
OA_BUSINESS_ROOT=/opt/oa-system/app/ChengyeOA/LayerManage/law-firm-system \
  node deploy/integration/backup.mjs /绝对路径/新的备份目录
```

脚本短暂停止 OA 后端和三个新服务，导出 PostgreSQL 并备份 OA 存储、任务/投稿/知识数据库及配置，记录 SHA-256，最后恢复先前运行的服务。备份包含密钥及私人资料，目录 0700、文件 0600，必须按敏感数据管理。

`check-restore.mjs` 在独立临时数据库恢复备份、核验文件包与 SQLite 完整性，结束后删除临时副本。默认使用本机 PostgreSQL 管理员 Unix socket；异机指定 `RESTORE_ADMIN_URL`。绝不把恢复演练指向现有业务库。

真实恢复需要停止写入：核验哈希，将 `oa.dump` 恢复到正确的新数据库；文件包中的 `var/storage` 与根 `.env` 属于 OA 后端，`data/integration/.dsh/WeKnora/konwledge-md` 分别还原到新项目对应位置。核对所有权、0600 密钥、配置地址与模型依赖后再启动。不可只恢复数据库而丢失不可变文件版本或任务元数据。

发布备份和恢复演练目录为 `/opt/oa-system/backups/20261115-smart-case-release`；详细验收及全量回归限制见 [VALIDATION.md](VALIDATION.md)。


## AI 人民币费用台账

超级管理员在“AI 与授权管理 → AI 费用与财务授权”按连接、供应商返回的实际模型标识与生效时间新增价格版本。单位统一为人民币元 / 百万 Token，无币种转换。输入、输出单价必须明确填写；缓存项留空表示未配置，0 表示明确免费。修改价格不追溯更改已核算调用。补核指定月份仅处理有完整供应商用量、且已有对应生效价格的待核算调用。

台账从本功能首次启用时开始；没有可靠用量的旧记录不回填。按调用开始时间所属北京时间自然月归集。任务对话和 OCR 计入任务所有人的个人账单；备用模型和每次重试分别记账。供应商未返回完整用量、网络中断、缺少价格时保留“待核算”，不算免费。缓存读取从包含缓存的输入中扣除，推理 Token 已包含在输出中，不重复加收。计算保留 10^-18 元整数精度，汇总后四舍五入到分；Excel 调用明细包含精确费用以核对尾差。

管理员连接测试单独记录为系统费用。公共知识库异步操作尚不能取得完整可信模型用量，只记录经过 OA 集成入口的操作为待核算；原生知识库后台调用仍需对照服务商账单。不能据此宣称已覆盖所有外部服务成本。

普通账号只能读取和导出本人费用。财务查看、导出及核对范围由超级管理员逐账号授权；撤销后下一次请求重新校验。财务确认仅记录个人/律所承担金额，不生成工资单或扣款。后续新调用或补核会使已有财务确认失效，需重新核对。

持久文件为 DATA_DIR/billing-config.json（价格、财务授权和审计）及 DATA_DIR/billing/YYYY-MM.json（调用台账），须与 DATA_DIR 一并备份。任务删除不删费用记录。单进程写入锁和原子文件替换沿用服务现有机制；进程重启会把未完成调用标记为中断待核算。台账不保存提示词、回复正文、API 密钥或连接凭证。
