---
description: "用于 DeepSeek Harness 专用产品 Profile 的 Windows 开发桌面外壳。"
kind: "application"
---

# 产品桌面应用

[English](README.md) | 中文

## 摘要

本应用是 F002 最小 Windows Desktop Host。它在操作系统分配的回环端口上启动正式 `product` Profile，
并在一个经过安全加固的 Electron 窗口中显示同一套 Web 产品 UI。产品行为仍由 `packages/product/`
负责；本目录只负责进程监督、桌面生命周期、操作系统集成以及未来的交付工作。

## 目录

- [准备和启动](#prepare-and-launch)
- [桌面行为](#desktop-behavior)
- [安全边界](#security-boundary)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)

<a id="prepare-and-launch"></a>
## 准备和启动

使用 Node.js 22 或更高版本及 pnpm 11.7.0。在仓库根目录构建 Host、Client 和 Web 资源，再通过正式插件管理
路径创建专用 Profile。两次添加操作必须分开执行，保证产品 Bundle 位于 Web Bundle 之后。

```powershell
$env:DSH_HOME = 'D:\path\to\dsh-home'
pnpm run build:lib:host
pnpm run build:lib:client
pnpm run build:web
pnpm run dsh -- plugin --profile product add ./packages/bundle/web-app
pnpm run dsh -- plugin --profile product add ./packages/product/product-bundle
pnpm run dev:desktop
```

桌面端预检会拒绝缺失或顺序错误的 Profile，不会静默组合另一套应用。启动成功后会打开一个标题为
`DeepSeek Harness Product` 的窗口，可通过产品导航进入知识库中心。

<a id="desktop-behavior"></a>
## 桌面行为

同一时间只运行一个桌面实例、一个 Host 代际和一个主窗口。再次启动应用会恢复并聚焦现有窗口。关闭窗口只会
将其隐藏，托盘进程与 Host 继续运行；双击托盘图标或选择 **Show** 可恢复窗口。选择 **Quit** 时会先停止
Host，再退出 Electron。启动超时、Host 提前退出和主页面加载失败都会显示有界诊断，并脱敏启动令牌。

<a id="security-boundary"></a>
## 安全边界

外壳只接受 `http://127.0.0.1:<port>/?token=<token>` 形式的就绪 URL 或等价的 `localhost` 地址，要求恰好
一个合法令牌且不能包含额外查询状态。渲染器启用沙箱与上下文隔离，禁用 Node.js 集成，不提供 preload 桥、
通用 IPC 或文件系统 API。同源导航保留在窗口内，其他 HTTP(S) 链接交给系统浏览器，其他协议、权限请求和
弹窗一律拒绝。

<a id="model-experience"></a>
## 模型体验

### 产品 Profile 载体

#### 模型能看到什么

桌面外壳不会新增任何模型可见内容。专用产品 Profile 及其 Preset 继续定义所有面向模型的工具、提示与知识上下文。

#### Token 影响

外壳不会增加模型 Token；所有 Token 使用都来自 Web UI 中同一套产品 Profile 行为。

#### KV Cache 影响

外壳不会改变可复用的模型前缀或缓存行为。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和后续工作

- F002 是 Windows 开发外壳，尚不生成安装程序，也不暂存独立运行时。
- 代码签名、自动更新、发布通道及 macOS/Linux 交付均留待后续任务。
- 在产品品牌资源获批前，托盘图标使用程序生成的占位图。
- Plugin Center、恢复/安全模式、Preset Square、App Center 和更广泛的产品增强属于独立 Feature。
