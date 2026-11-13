# 更新记录

本文件记录 DSH TokenLedger Pro 分支的变更。原项目为 [zh667/TokenLedger](https://github.com/zh667/TokenLedger)，开发基线为 `438d3086249d427e7185a69c5453cb1553c84f0b`。

## 0.1.0-pro.0（开发中，尚未发布）

### 项目与发行准备

- 标注独立二次开发关系，保留 MIT 许可、原作者版权和第三方归属声明。
- 使用独立包名 `dsh-tokenledger-pro`，同步 Web 模块、Blue manifest 和加载行标识。
- 仓库、安装示例和问题反馈入口指向 SherryXXX8043/dsh-TokenLedger-pro。
- 默认索引改为 `tokenledger-pro.sqlite`；命令、配置命名空间、Host 服务和 HTTP 路径保持兼容，同一 profile 内不支持同时启用原版与 Pro。
- 增加迁移与回退说明；索引默认从宿主持久会话日志重建。

### 开发验证

- 修复 Windows 打包测试直接启动 `npm` 导致的 `ENOENT`，改由 Node 执行 npm CLI，避免依赖 shell 包装器。
- 同步分支标识测试与独立安装 fixture 的包引用。

本版本没有新增业务功能或供应商适配，尚未发布到 npm；真实 DSH / Blue 界面与供应商接口兼容性需独立验收。
