# 更新记录

本文件记录 DSH TokenLedger Pro 分支的变更。原项目为 [zh667/TokenLedger](https://github.com/zh667/TokenLedger)，开发基线为 `438d3086249d427e7185a69c5453cb1553c84f0b`。

## 未发布：Desktop 支持（feat/desktop-support）

- 设置新增默认显示账户下拉，选择持久化到 volatile Config；新开账本优先应用，临时切换不改默认，账户失效自动回退。余额、账户选择器和凭据对话框使用同一账户身份。
- 以 DSH 0.2.2-rc.3 为当前验证基线，增加侧边栏面板入口和全页用量账本；旧 footer 保留回退。
- Desktop IPC / Web 共用宿主 Connection Fetch 路由，客户端不写死端口；不再导入内部 UI primitives。
- 修复当前日志 attempt / stream usage、同一步重试与 fork 继承去重；索引 schema 升至 5。
- 首次扫描和 persistence 实例替换不信任旧持久化 revision，防止错误跳过。
- 修复卸载后晚到请求、账户切换旧余额和重叠 HMR 旧样式问题。
- 修复全页误用浮层灰色半透明背景导致的灰蒙观感；页面使用 bg-base，表头与说明使用 secondary，跟随当前 Desktop 的 data-ds-dark-theme 标记。新增回归测试后 536 项通过。
- 迁移到当前 Config/volatile 设置契约，账本顶部增加设置模态框，插件详情页提供同一表单；JSON 类型检查、revision 冲突与请求取消均有回归覆盖。
- 从 ConfigEditor 的有效 provider 配置读取端点和凭据引用；修复嵌套 volatile 读取、自定义默认地址被误标官方及配置变化时的来源绑定。
- 新钱包令牌存入宿主 credentials record；保留旧来源只读兼容，记录异常与普通余额查询隔离，返回白名单可操作错误码。
- 设置、供应商、凭据与 UI 完整测试达到 580 项通过；当前 Desktop 已识别 Config schema 和插件配置槽，真实保存/余额与最新后端重启验收仍待确认。设置说明见 docs/SETTINGS.md。
- 增加中英文插件元数据及原创图标；535 项自动测试通过，当前 Desktop 安装和实时入口注册通过；真实窗口交互和供应商余额尚待验收，见 docs/DESKTOP-SUPPORT.md。

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
