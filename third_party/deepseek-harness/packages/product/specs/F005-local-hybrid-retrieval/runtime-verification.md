# F005 本机运行验证

## 验证环境

- 日期：2026-09-04
- 系统：Windows 11 家庭版 `10.0.26200`
- CPU：Intel Core i7-12700，12 核、20 逻辑处理器
- 内存：16,849,539,072 bytes（约 15.69 GiB）
- Node.js：`v24.18.0`
- pnpm：`11.7.0`
- 运行时：`@huggingface/transformers@4.2.0`、`onnxruntime-node`
- 设备：CPU；未使用 CUDA

## 已锁定的 dev.1 基线

- 模型：`intfloat/multilingual-e5-small`
- revision：`614241f622f53c4eeff9890bdc4f31cfecc418b3`
- ONNX 文件：`onnx/model.onnx`，FP32
- 维度：384
- 池化与归一化：mean pooling、L2 normalize
- 查询前缀：`query: `
- 正文前缀：`passage: `
- 投影：文档名、标题、正文前 1,800 字符，版本 `document-heading-content-v1`
- 默认批大小：8
- 语义候选最低归一化余弦：0.82；这是 dev.1 安全基线，必须通过真实问题集重新校准
- 模型缓存：`$DSH_HOME/product/knowledge/embedding-models`；产品运行时只允许从本地缓存加载

模型文件校验：

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `config.json` | 655 | `69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959` |
| `tokenizer_config.json` | 443 | `a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b` |
| `tokenizer.json` | 17,082,730 | `0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39` |
| `onnx/model.onnx` | 470,268,510 | `ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665` |

缓存共 5 个文件、487,352,993 bytes；第五个文件是 revision 目录中的同内容 `config.json`。

## 一次兼容性测量

通过 `pnpm --filter @deepseek-ai/dsh-product-knowledge benchmark:embedding` 显式执行安装兼容性测量：

| 指标 | 结果 |
|---|---:|
| 首次下载与加载 | 47,784 ms |
| 3 条文本首批推理 | 33 ms |
| 禁网后重新加载 | 1,645 ms |
| 进程 RSS 增量 | 404 MiB |
| 相关中英文样本余弦 | 0.894141 |
| 无关样本余弦 | 0.785494 |
| 在线/离线向量一致 | true |

这些数字是当前主机的一次工程兼容性测量，不是质量基准或长期性能承诺。运行时 Provider 使用 `local_files_only: true`，模型缺失或损坏时不会联网，会回退词法检索。

另以真实 Provider 完成一次内存 SQLite 闭环：导入中文“扫描研究”和无关“市场”分块，以英文问题 `How is text recovered from scanned pages?` 查询；结果为 `actualMode=hybrid`、`semanticIndexRevision=2`、1 个通过 0.82 阈值的语义候选，最终只返回“扫描研究”原始分块。这只证明链路和基础跨语言行为可运行，不替代用户语料评测。

## dev.2 实现结论

- 当前 Windows CPU 主机可运行轻量 E5，资源占用可以接受，因此 dev.1 采用 Node Host 内本地 ONNX 路线，不增加第二套 Python 环境。
- SQLite 保存按知识库 revision 发布的派生向量；构建使用 staging build，同一知识库只允许一个进程内构建，成功后才切换 active build。
- 未改变的分块在模型、revision 规则与投影版本一致时复制已验证向量，不重复推理；导入、重新处理、删除、恢复及重启后均按正文 revision 懒重建。
- 精确余弦扫描上限为 50,000 个分块；超限、模型故障或索引不可用时返回词法结果。
- `lexical` 仍是 Product Bundle 默认值。`hybrid` 已接通搜索、本地回答和流式模型问答的证据检索，界面会显示实际模式、索引 revision、语义候选数和降级原因。
- 设置页现在可读取索引状态、source/index revision、覆盖率、分块数、模型 revision、维度和阈值，并可重建、取消构建或清除派生向量；清除向量不会影响词法检索或源文档。
- 高级评测会在同一知识库 revision 上顺序执行 baseline、optimized 和 hybrid Profile，记录每例及聚合 Recall@10、MRR@10、查询延迟、七维分数和相对退化情况。
- 自动化用例验证了跨语言语义候选、revision 重建、缓存复用、重启复用、扫描上限、模型失败降级、取消清理和索引管理。用户真实论文固定问题集、BGE-M3 对比及最终推荐状态仍待人工验收决定。
