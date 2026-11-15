# 腾讯云网关 + 本机算力

这台轻量机（2C2G，`162.14.78.238`）只做 HTTPS 入口。鉴定进程、病历、API Key 都留在 `E:\A` 这台 Windows 主机。

## 路径约定

外网用户看到的是：

- `https://<域名>/` 工作台
- `https://<域名>/api/` 案件与账号（Cookie 鉴权）
- `https://ai.<域名>/` 鉴定助手（登录后由 `/api/go/ai` 服务端换 cookie 再 302）
- `https://kb.<域名>/` 知识库控制台（仅平台维护者 / 公共库管理员，经 `/api/go/kb`）

助手与知识库都占用 `/api`，所以不能和工作台挤在同一个主机名下，必须用子域名。

未绑域名时可先用 `162-14-78-238.sslip.io`，不要长期用裸 IP + HTTP 传病历。

## 云机

1. 安全组只放行 **80、443**，以及 frps 的 **7000**（来源限制为本机公网 IP 更稳）。
2. SSH 上去执行：

```bash
sudo bash cloud-setup.sh
# 或先改 FRP_TOKEN、DOMAIN 再执行
```

3. 把 `deploy/Caddyfile` 拷到 `/etc/caddy/Caddyfile` 后 `systemctl reload caddy`。
4. 把 `frps.toml` 的 `auth.token` 改成强随机值，与本机 `frpc.toml` 一致。

## 本机数据隔离

| | 本地调试 | 公网部署 |
|---|---|---|
| 启动 | `start-all.ps1` / 桌面「一键启动鉴定助手」 | `start-deploy-all.ps1` / 桌面「一键启动公网部署」 |
| 数据根 | `E:\A\cases`、`E:\A\data`、`E:\A\.dsh` | `E:\A_Medical_DATA\cases`、`...\data`、`...\.dsh` |
| 端口 | 5180 / 5181 / 3081 | 6180 / 6181 / 4081 |
| frpc | 不连本地端口 | 连 6180/6181/4081 |

两边互不可见案件、账号、助手会话。知识库 WeKnora（8090）仍共享标准库。

## 本机

1. 运行 `deploy/disable-sleep.ps1`（管理员），关掉休眠。
2. 下载 [frp](https://github.com/fatedier/frp/releases) Windows amd64，把 `frpc.exe` 放到 `deploy/bin/`。
3. 改 `deploy/frpc.toml` 的 token 与云机 IP（已指向部署端口 6180/6181/4081）。
4. 复制 `deploy/gateway.env.example` 为 `E:\A_Medical_DATA\data\gateway.env`，按真实域名填写。
   `start-harness.ps1` 会从 `AI_PUBLIC_BASE` 自动向 dsh 传递 `--trusted-host`（公网 API 403 时检查此项）。
5. 先 `start-deploy-all.ps1`（或 `deploy/start-public.ps1`），再确认 `deploy/start-frpc.ps1`。
6. 本地开发继续用 `start-all.ps1`，不要把 frpc 指回 5180/3081。
7. 建议计划任务：开机运行 `start-deploy-all.ps1`、`start-frpc.ps1`、`watch-tunnel.ps1`；每天备份 `E:\A_Medical_DATA\cases`。

验收：外网能打开工作台并登录；本机关机则云上 502；本地 `127.0.0.1:5180` 看不到公网案件。

首次管理员密码写在 `E:\A_Medical_DATA\data\admin-initial-password.txt`，登录后立刻改掉。

## 以后把算力迁到更大云机

域名与 Caddy 配置不用动。把 Windows 上的四项服务迁到新机器后，只改 `frpc.toml` 的 `serverAddr`（若网关仍是这台 2C2G）或改 Caddy 回源地址。密钥与 `cases/` 一起搬家，不进 2GB 轻量机。
