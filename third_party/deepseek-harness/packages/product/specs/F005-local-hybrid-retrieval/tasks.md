# F005 任务

## Spec 阶段

- [x] 核实 Studio 没有已实现的 Embedding 向量索引。
- [x] 确认混合检索只补充语义候选，词法检索与原分块继续作为权威基线。
- [x] 定义本地模型、显式安装、离线运行、索引缓存和安全降级要求。
- [x] 定义词法/混合成对评测指标与升级门槛。
- [x] 登记 Feature Map 与产品 Spec 索引。

## 验证与实现阶段

- [ ] 建立用户代表性论文与固定问题集，不把私人语料提交仓库。
- [x] 在当前 Windows CPU 主机验证 `multilingual-e5-small` 的 ONNX 运行、内存、吞吐和兼容性样本；结果见 [本机运行验证](runtime-verification.md)，真实语料召回仍待固定问题集。
- [ ] 在资源允许时验证 `bge-m3`，记录模型 revision、哈希和性能差异。
- [x] 根据实测锁定 dev.1 的轻量 E5、Node ONNX、1,800 字符投影、批大小 8 和有界配置；推荐状态仍由真实语料评测决定。
- [x] 实现私有本地 Embedding Provider、版本化 staging/active 向量表和未变分块缓存。
- [x] 实现异步精确向量候选、确定性 RRF、词法降级和可追溯原分块结果。
- [x] 接通导入、重新处理、删除、恢复、取消清理和 Runtime 重启后的 revision 懒重建。
- [x] 搜索、问答和流式问答接通实际检索诊断；高级评测增加 hybrid Profile、Recall@10、MRR@10 与查询延迟。
- [x] 设置页增加语义索引状态、revision、覆盖率、模型元数据，以及重建、取消构建和清除派生向量操作。
- [x] 建立不提交私人语料的 [人工验收清单](manual-acceptance.md)，本机测试 Profile 独立启用 `hybrid`，正式 Bundle 继续默认 `lexical`。
- [x] 完成自动化、独立 Product 测试 Profile 和 Windows Host 启动验证。
- [ ] 使用用户代表性论文完成固定问题集评测和人工验收。
- [ ] 根据评测决定保持实验状态或升级推荐配置，并回填版本与实现 SHA。
