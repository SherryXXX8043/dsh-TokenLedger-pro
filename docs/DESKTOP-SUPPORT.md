# Desktop 支持与环境验证

## 范围与状态

第一期目标：在当前 DSH Desktop 发现并打开用量账本，使用宿主连接通道读取统计与余额，继续保留 Web 查询与既有领域 API。

开发分支为 `feat/desktop-support`，独立于尚未合并的 `main`。当前版本仍为开发预发布 `0.1.0-pro.0`，未发布 npm。默认账户功能加入后完整回归为 583 项通过；实际用户保存及其重启持久化仍待确认。

## 已核对的环境

- Windows Desktop profile：`desktop`。
- CLI / DSH 包：`0.2.2-rc.3`。
- 实际 Desktop Electron：`44.7.0`，内嵌 Node：`24.21.0`，`node:sqlite.DatabaseSync` 可用。
- 运行时文档与 API 来自当前安装的 app.asar，未使用其他版本的实现代替。
- 查阅了用户指定的“了解next-ai-draw-io插件”会话，只提取 TokenLedger 相关记录。历史记录证明当时 HTTP 返回 200，但没有 Desktop 页面与 IPC 的验收；因此本次重新核对接口，不沿用历史助手的唯一原因判断。

## 修改内容

1. 当前界面注册到 root `sidebar.panellist` 与同 key 的 `main`，名称为“用量账本 Pro”。缺少现代声明时保留旧 footer 浮层回退；现代入口可用时隐藏旧入口。
2. 移除运行时 `require('@deepseek-ai/dsh-client-ui-primitives')`，用自绘 SVG 图标；样式归 apply 生命周期所有，重叠加载应用最新 CSS，最后 owner 卸载才删除。
3. 请求优先使用官方 `__DSH_TRANSPORT__.fetch`，普通浏览器回退 global fetch，统一使用 `api/tokenledger/...` 文档相对路径，不写死端口。已有 carrier 报错不切换另一个 carrier 重投凭据操作。
4. Host 将查询与凭据接口注册到 `connection.fetch`，供 Desktop IPC 与 Web `/api` 共用。存在现代 Connection 时不注册会遮盖共享认证桥的 exact HTTP 路由；晚挂载 Connection 时移除旧路由。旧宿主 HTTP 回退仍保持回环校验及可用的宿主认证。
5. 查询、余额与凭据读取取消请求、拒绝晚到结果；切换账户立即隔离上一账户余额，同账户刷新可以保留旧值。
6. 当前日志支持 `assistant/attempt.stream`、message 的 stream usage 回退以及同一步 `llm/retry-started` 的独立计费。优先使用 handle 的 `inheritedEventCount`，按 log offset 排除继承前缀，只恢复其中请求归属元数据；保留旧格式兼容。
7. SQLite 索引版本升到 5，旧派生索引重建。持久化 revision 只在同一 runtime 实例首次成功读取后可信，进程或 persistence 实例变化不沿用旧 token 跳过。
8. 增加中英文插件管理元数据、原创账本图标和 DSH `>=0.2.2-rc.3` 验证基线。保留 `platform: web`，这是 Desktop / Web 的共享客户端平台标识。

## 已完成的验证

- `npm test`：535 项通过，0 失败；开发依赖匹配当前 Cordis 4.1.0 / Schemastery 3.19.0。
- 实际 Desktop Electron `44.7.0` / Node `24.21.0` 执行后端专项：138 项通过，0 失败。覆盖 apply、Connection、HTTP、usage、fork handle、store、plugin 与启动测试。
- 使用当前安装版 `@deepseek-ai/dsh-client-connection` 的真实 `HostConnectionService` 和实际 Cordis，在独立内存 Context 中验证：usage 200、合成 balance 200、合成 userauth POST 200、非 owner Peer 403、卸载后 404。该检查无网络 listener，不使用真实 browserAuth / cookie / 用户凭据；因此不等于实际 Desktop renderer 已发出成功请求或真实余额已查验。
- `npm pack --dry-run --json` 通过，包含语言、图标、许可证和迁移资料。
- 客户端专项覆盖 transport、相对路径、异常不重投、slot 生命周期、卸载取消、HMR CSS 和跨账户数据隔离。
- Connection 专项覆盖没有 HTTP listener 的 Host、方法限制、4 KiB 字节限制、错误脱敏、取消与晚挂载路由交接。
- 日志专项覆盖 current attempt / message、重试结算、fork 去重、空自有尾、索引重建和 runtime revision 信任边界。
- 2026-11-14 安装到当前 Desktop profile：Plugin Manager 返回 `application: applied`。
- 安装后实时 Client Inspect：`sidebar.panellist` 的 `tokenledger-pro` 以及 `main` 的同名 key 均 `active: true`。
- 只读查询实际 `tokenledger-pro.sqlite`：schema 5，65 个已跟踪会话、63 个有用量会话、86 条汇总、0 条 provider/model unknown 记录（安装验证时快照，后续会变化）。没有读取或展示提示词、工具参数或凭据。
- 对当前 HTTP `/api/tokenledger/usage` 发未认证请求返回 401，符合宿主认证边界。没有读取浏览器 cookie 或私密 token 以绕过认证。
- 重启后复查：当前 GUI 地址已变为 `http://127.0.0.1:60410`；Host 仍存在 Pro 加载行，实时 Client 侧栏入口仍 active。独立索引更新为 67 个已跟踪会话、65 个有用量会话、88 条汇总、0 条 unknown；新端口未认证请求仍为 401。该结果证明重启后加载与采集持续工作，不代表主页面点击与供应商余额已经验收。
- 用户提供的实际 Desktop 截图已确认左侧入口和主页面统计渲染成功；截图同时揭示旧设置读取导致的未知路由及全页误用浮层灰底。灰底已改为正常页面背景，536 项回归测试通过；修复后的外观仍待新截图确认。
- 当前运行时 Config Inspect 已从 `absent` 变为 `schema`，识别到本插件的 volatile 路由、费率和端点字段。新版 SettingsForms 的独立内存验证已通过配置投影、volatile 更新与旧 revision 拒绝。
- 当前供应商读取改用真实有效 Config；自定义目录即使提供默认地址也不会被误标为官方。新钱包查询凭据保存在 credentials record，相关隔离与错误状态有合成测试。
- 后续完整测试为 580 项通过、0 失败，打包和差异检查通过。设置界面注册在 `plugins.bundle.config` 的 `dsh-tokenledger-pro` key，实时 Client Inspect 为 active；顶部按钮复用同一表单，独立 UI/UX 审阅通过，真实页面保存仍待确认。
- 使用当前安装版真实 SettingsForms 和 Electron 做独立内存验证：配置保存后经业务 getter 立即读回新值、清空路由覆盖、保留数据库启动参数、拒绝旧 revision 均通过。验证未写入当前 profile 或用户凭据。
- 用户后续截图确认正常深色页面、顶部设置入口、DeepSeek 真实余额和 New API 账户读取；New API 不限额度 Key 显示“已用”，不能当作钱包余额。中转站分布已恢复为主要站点及约 1% 未知路由。
- 设置窗口截图确认三个字段成功加载为 `{}` / `null` / `[]`，没有只读或加载失败提示；尚无实际保存成功证据。钱包凭据对话框可打开，但截图显示残留旧灰色半透明背景，现已改为不透明 layer-1、说明 secondary 和输入 base；统计按钮显式使用 layer-1，避免浏览器默认灰底。完整 580 项测试通过，独立样式审阅通过，Plugin Manager 重载 applied；这两处最新样式仍待窗口反馈。
- 独立 UI/UX 与兼容审阅发现并修复晚挂载路由遮盖、跨账户余额混用和重叠 HMR CSS 不更新问题。

## 尚未完成的真实窗口验收

当前无可操作的 Desktop 浏览器控制工具。Client slot active、索引存在和自动测试均不等价于真实渲染和交互通过。以下需要在实际 Desktop 完成：

1. 页面初始渲染已有用户截图确认；下一步检查新“设置”入口、插件配置区、保存和冲突提示。
2. 切换今日 / 本月 / 累计、站点、模型排序，点击刷新，观察加载状态与结果。
3. 切换余额账户，确认不显示上一账户的余额；验证实际供应商余额或套餐响应。没有更换或新增供应商适配，本轮不宣称所有供应商已验收。
4. 切换深浅主题、展开/折叠侧栏、改变窗口大小；检查字体、图表、滚动、键盘与对话框。
5. 宿主重启后再次打开，确认插件、索引及请求仍正常。独立 Web 部署和 Blue 实机验收尚未运行。

同一 profile 不可同时启用原版与 Pro。安装保留了旧 `tokenledger.sqlite`，Pro 使用独立索引；显式配置数据库时按 PRO-MIGRATION.md 检查。安装为本地开发链接，后续代码替换是否生效以 Plugin Manager 的应用结果和实际页面为准，不能仅凭修改文件宣称已热更新。
