# F003 任务

## Spec 阶段

- [x] 检查当前 Windows 主机 CPU、内存、GPU、磁盘和 Python 状态。
- [x] 确定本地 PP-StructureV3、CPU 单并发和无云端回退方案。
- [x] 定义原生文本优先、问题页 OCR、质量重试、缓存和原子提交契约。
- [x] 定义 Worker 生命周期、安全限制、UI 诊断和真实验收标准。
- [x] 将 F003 登记到产品 Feature Map。

## 实现阶段

- [x] 验证并锁定 Python 3.11.9、PaddlePaddle 3.3.1、PaddleOCR 3.7.0、PaddleX 3.7.2 和 PP-StructureV3。
- [x] 建立应用管理的 Windows x64 隔离 Worker 环境及模型清单。
- [x] 建立产品文档 OCR Provider 和 F001 Consumer 边界。
- [ ] 完善 Worker 监管（动态回环端口、每代凭据和有界关闭已完成；健康状态、任务取消待完成）。
- [x] 实现页级原生文本质量检测、问题页渲染和本地 PaddleOCR CPU 推理。
- [x] 使用代表性 IRCOBI 论文测量资源，并将 16 GiB 主机默认收敛为 PP-OCRv5 server 文字检测/识别、1200 像素、CPU 单并发预设。
- [x] 将大文件 Base64 校验改为恒定调用栈的线性扫描，并加入 8 MiB 二进制回归测试。
- [x] 验证此前失败的 7.67 MB、24 页论文可完成解码，且仅第 14 页进入 OCR。
- [ ] 将完整 PP-StructureV3 作为可选增强重新引入；启用前必须先完成结构数据消费、后台队列、取消和资源预算。
- [ ] 实现结构化区块规范化、质量判定、一次有界重试和待复核状态。
- [ ] 实现版本化缓存、schema 迁移、原子重新处理和派生数据清理。
- [ ] 接通文档详情、知识库设置、进度、诊断、取消和重新处理 UI。
- [ ] 完成自动化 fixture、资源限制、Worker 故障和持久化恢复测试。
- [ ] 完成 Product Profile 与 Windows Desktop 的人工导入闭环；底层真实文件链路已通过，待用户在重启后的桌面界面复测。
- [ ] 更新 README、来源记录、产品版本映射、Feature Map 和实现提交 SHA。

本机版本、模型校验值、兼容性结论和端到端冒烟证据见 [运行时验证](runtime-verification.md)。
