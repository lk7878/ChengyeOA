# F003 本机运行时验证

## 版本与位置

- 验证日期：2026-09-04。
- Python：3.11.9，位于 `D:/2_test/C33_deepseek-harness/.runtime/python311`。
- OCR 虚拟环境：`D:/2_test/C33_deepseek-harness/.runtime/paddleocr`。
- PaddlePaddle：3.3.1；PaddleOCR：3.7.0；PaddleX：3.7.2。
- 模型缓存：`D:/2_test/C33_deepseek-harness/.runtime/paddleocr-models`，10 个模型共 1,805,422,948 字节。
- Worker 默认设备：CPU；未修改系统 PATH，未使用 Microsoft Store Python 别名。

`worker/runtime-manifest.json` 锁定运行时组合，`worker/models.lock.json` 记录每个官方模型权重的 SHA-256。模型来自 PaddleX 官方 BOS 模型源；正式推理使用显式本地模型目录并跳过模型源连通性检查。

## 兼容性结论

完整 PP-StructureV3 在本机 16 GiB 内存和 PaddlePaddle 3.3.1 Windows CPU 环境下启用 oneDNN 时触发运行时算子兼容错误；禁用 oneDNN 后，同时加载表格与公式专用模型的进程仍不够稳定。进一步使用代表性 IRCOBI 论文测试时，图表密集页在 1800 像素渲染宽度下的 Worker 私有内存一度超过 27 GiB；即使关闭区域检测并降到 1200 像素，处理仍未在可接受时间内稳定完成。

因此 dev.2 的本机默认改为低资源文字预设：原生文字层仍是权威来源，仅对质量门失败页调用本地 `PaddleOCR`，加载 `PP-OCRv5_server_det` 和 `PP-OCRv5_server_rec`，渲染宽度为 1200 像素，CPU 单并发。该方案保留页码、文字区块坐标、置信度和待复核信息，但不宣称已经产生表格、公式或图表的专用结构语义。完整 PP-StructureV3 保留为后续可选增强，需在结构数据真正持久化、后台队列、取消和资源预算闭环后再启用。

## 真实链路冒烟测试

dev.1 使用本地生成的一页图片型 PDF 验证了 Product Runtime 实际路径，不使用测试替身：

1. PDF 原生文本质量门判定该页需要 OCR。
2. `pdf-parse` 将单页渲染为 1800 像素宽图像。
3. TypeScript Host 启动只监听 `127.0.0.1` 动态端口、使用随机凭据的 Python Worker。
4. Worker 从项目模型缓存加载 PP-StructureV3 轻量预设并完成识别。
5. 识别正文写入 Markdown，文档状态为 `ready`，本地检索命中测试短语。

冷启动和该页识别约三分多钟。该数字只证明当时的合成样本可运行，不作为通用性能承诺。

## dev.2 代表性论文回归

使用用户提供的 `IRCOBI2025-2574-Strain-based risk fracture evaluation with freely available HBMs.pdf` 完成了真实文件回归：

- 文件大小 7,669,076 字节；上传编码后的 Base64 长度约 10.2M 字符。
- 旧版 Base64 正则校验在该长度触发 `Maximum call stack size exceeded`；现已改为恒定调用栈的线性字符扫描，并增加 8 MiB 二进制回归测试。
- 文档共 24 页，其中 23 页直接采用原生文字，只有图表密集的第 14 页进入 OCR。
- 第 14 页使用 1200 像素渲染宽度和 PP-OCRv5 server 检测/识别，约 178.81 秒返回 194 个文字区块。
- 完整解析得到 59,995 个正文字符、1 个 OCR 页和 4 个待复核区块；解析器为 `pdf-parse@2.4.5`，OCR 模型标识为 `PP-OCRv5-server`。

以上结果证明这份此前失败的论文已能走通真实解码、原生文字质量门、按页 OCR 和规范化返回链路。耗时仍表明 OCR 应继续保持“只处理失败页”；后台进度、取消、缓存和结构化版面增强仍是后续工程项。
