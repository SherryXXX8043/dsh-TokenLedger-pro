# DSH TokenLedger Pro

[![License](https://img.shields.io/badge/license-MIT-2da44e)](LICENSE)
[![DSH](https://img.shields.io/badge/dsh-%3E%3D0.2.2--rc.3-1f6feb)](https://github.com/deepseek-ai/deepseek-harness)

基于 [zh667/TokenLedger](https://github.com/zh667/TokenLedger) 的独立二次开发项目，由 [SherryXXX8043](https://github.com/SherryXXX8043) 维护，计划在原有用量统计、余额查询和订阅配额功能基础上，增加新功能与供应商适配，并改进 DSH 兼容性和使用体验。

- **本项目仓库**：[SherryXXX8043/dsh-TokenLedger-pro](https://github.com/SherryXXX8043/dsh-TokenLedger-pro)
- **原始项目**：[zh667/TokenLedger](https://github.com/zh667/TokenLedger)，感谢原作者及所有贡献者。
- **开发基线**：上游提交 [`438d3086249d427e7185a69c5453cb1553c84f0b`](https://github.com/zh667/TokenLedger/commit/438d3086249d427e7185a69c5453cb1553c84f0b)。
- **当前状态**：开发预发布版本 `0.1.0-pro.0`。`feat/desktop-support` 实现 Desktop / Web 共用入口、连接通道、当前 Config 设置页和默认账户，并修复新日志格式的 fork / 重试统计。Windows DSH `0.2.2-rc.3` 的实际截图已确认主页面、中转站归属、DeepSeek 余额、New API 已用额度及设置加载；583 项自动测试通过。默认账户的真实保存、最新弹窗样式、明暗主题切换与独立 Web 部署仍待验收，详见 [Desktop 验证记录](docs/DESKTOP-SUPPORT.md)。
- **维护方式**：本项目独立维护和发布；功能建议与问题反馈请提交至[本仓库 Issues](https://github.com/SherryXXX8043/dsh-TokenLedger-pro/issues)。后续按需选择性同步上游更新。
- **开源许可**：继续采用 MIT，保留上游版权、许可文本及第三方声明，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

项目显示名称为 **DSH TokenLedger Pro**，包名为 `dsh-tokenledger-pro`，加载行标识为 `tokenledger-pro`，默认索引为 `tokenledger-pro.sqlite`。命令 `/tokenledger`、配置命名空间 `tokenledger`、Host 服务 `ctx.tokenLedger` 和 HTTP 路径暂时保持兼容，因此同一 profile 内只启用原版或 Pro 版之一。安装、备份和回退步骤见 [迁移说明](docs/PRO-MIGRATION.md)。

## 基础能力 / Inherited capabilities

以下内容基于上游 TokenLedger 的功能说明。

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Token 用量算清楚，并归属到**实际服务这次请求的中转站**——通常无需额外配置即可查看用量；余额查询需要相应凭据。

Token-usage accounting for DeepSeek Harness, attributed to the relay site that
served each request. The existing Web GUI (`dsh web`) and renderer-neutral
consumers share the same host-owned aggregation. Zero configuration.

![TokenLedger 面板](docs/images/panel.png)

> 展示图使用演示数据与本机模拟中转站；面板上的每个数字都由真实代码路径算出，只是数据是造的。插件不会把 API Key 或上游原始响应发送到浏览器。

## 一眼看懂 / At a glance

| | 能力 | 说明 |
| --- | --- | --- |
| 🎯 | **中转站归属** | 按 provider 的 `baseURL` 归一化 origin 分组——同一站的多把 key 合成一行，站名就是域名，不是你自己起的路由别名 |
| 📁 | **按项目归属** | 用量按会话启动时所在的目录分组——工作区注册过的用它的标题，没注册过的用目录名，子目录里起的会话照样算进去 |
| 🔍 | **零配置发现** | 从宿主的 provider 配置里读出中转站，不用你再填一遍。只读 `baseURL`，绝不碰旁边的凭据 |
| 💳 | **余额** | DeepSeek 官方、New API、Sub2API，每个账户一把普通 key 即可；不限额度的 key 报"已用"而不是假余额 |
| ⏳ | **订阅配额** | 卖套餐不卖余额的家数越来越多——5 小时 / 每周 / 每月各自滚动、各自重置，每个窗口一条进度条和一个重置时刻 |
| 📊 | **用量分析** | 今日/本月/累计三窗口、按站点/模型下钻、缓存命中率、一年活跃度热力图（悬停看当天模型构成） |
| 🧮 | **费用估算** | 生效日期分段的费率表、分桶计价、峰谷时段；未定价的模型显示破折号而不是 0 |
| 🗂 | **导出与诊断** | CSV / JSON 导出，索引健康度，归因不上的行数单独列出 |
| 🔒 | **宿主认证** | 当前 Desktop / Web 共用认证连接通道，查询不返回密钥；旧 HTTP 回退仍限制回环访问 |

## 快速安装 / Quick start

本分支当前以 DSH `0.2.2-rc.3` 为最低验证基线，支持 Desktop 与 Web 的共同插件机制；`dsh.client.platform: web` 表示共享浏览器界面，不排除 Desktop。

本地开发：在 Desktop 的插件管理中添加本仓库目录。开发版安装后左侧导航或“更多”中会出现「用量账本 Pro」，点击打开主内容区。不要同时启用原版。替换已安装源码时，按插件管理器返回的提示重载或重启；本项目不保证没有构建 watcher 时自动热更新。

以下 GitHub 安装示例针对对应改动已经推送的分支。`web` 可替换为实际 profile（例如 `desktop`）：

```bash
dsh plugin --profile web add "github:SherryXXX8043/dsh-TokenLedger-pro#feat/desktop-support"
```

当前 Desktop 适配在 `feat/desktop-support` 分支独立维护，尚未合并到 `main`。从默认分支安装仍会得到之前的准备版本；测试本期功能请显式选择上述开发分支。

升级或卸载：

```bash
dsh plugin --profile web update dsh-tokenledger-pro
dsh plugin --profile web remove dsh-tokenledger-pro
```

重装同一个 spec 可重新解析来源；固定版本时应使用本仓库对应 Pro 版本的完整 40 位提交 SHA。

| spec | 说明 |
| --- | --- |
| `github:SherryXXX8043/dsh-TokenLedger-pro` | 跟随默认分支 |
| `github:SherryXXX8043/dsh-TokenLedger-pro#main` | 跟随 main 分支 |
| `github:SherryXXX8043/dsh-TokenLedger-pro#<完整40位提交SHA>` | 将占位符替换为实际 Pro 提交；不要使用短 SHA |

上游基线提交保留原包名，仅用于追溯来源。当前 Pro 改动在提交并推送之前，远程安装仍会得到之前的源码。

如果 `package.json` 里已经被写进了一个解析不了的 spec，`add` 也会失败——它会先解析整份清单。改掉那一行再 `install` 即可。

装完之后 `/tokenledger diagnostics` 会打印当前的路由归属和索引里的路由——**排查「我的中转站为什么不显示」看这里**，不用猜。

装完即可用：没有要填的配置，也不需要任何凭据就能看到全部用量与中转站分布。余额是唯一用到 key 的地方，而那把 key 宿主已经替你存着了。

## 命令 / Commands

面板能回答的问题，命令行都能回答——两边读的是同一批查询，不存在第二套聚合。

```bash
/tokenledger                      # 全部时间
/tokenledger 7                    # 最近 7 天
/tokenledger 30 api.example.com   # 某个中转站，最近 30 天

/tokenledger site                 # 列出发现到的中转站
/tokenledger site add <路由名> <地址>
/tokenledger site rm <路由名>

/tokenledger export csv 30        # 导出
/tokenledger diagnostics          # 索引健康度
/tokenledger reindex              # 丢弃索引，从头重建
```

## 支持的账户类型 / Providers

| Provider | 模式 | 凭据 | 上游接口 |
| --- | --- | --- | --- |
| DeepSeek 官方 | 余额 | provider 的 `apiKeyEnv` | `/user/balance` |
| New API 系（含 One API、VoAPI 等分支） | 余额/额度 | provider 的 `apiKeyEnv` | `/api/usage/token/` + `/api/status` |
| Sub2API | 余额 / 额度 / 订阅 | provider 的 `apiKeyEnv` | `/v1/usage` |
| Moonshot / Kimi | 余额 | provider 的 `apiKeyEnv` | `/v1/users/me/balance` |
| 智谱 GLM / Z.ai | 余额 | provider 的 `apiKeyEnv` | `/api/biz/account/query-customer-account-report`，读不到时回退 `/api/paas/v4/balance` |
| OpenRouter | 余额 | **Management Key** | `/api/v1/credits` |
| OpenCode Go | 订阅 | provider 的 `apiKeyEnv`，或本机 `auth.json` | `/zen/go/v1/usage` |
| Kimi For Coding | 订阅 | provider 的 `apiKeyEnv` | `/coding/v1/usages` |
| MiniMax Coding Plan | 订阅 | provider 的 `apiKeyEnv` | `/v1/token_plan/remains` |
| 智谱 GLM / Z.ai Coding Plan | 订阅 + 余额 | provider 的 `apiKeyEnv` | `/api/monitor/usage/quota/limit` |

除 OpenRouter 外都只需要一把**普通 API key**——就是你已经配给那条路由、用来发请求的那把。OpenRouter 的额度接口只认 Management Key，用推理 key 会 401，面板会直接说明要哪一把，而不是丢一个 401 让你去查一把本来没问题的 key。

**订阅**这一档没有余额可读，读到的是若干个滚动窗口：一条进度条、一个百分比、一个重置时刻。金额和窗口**可以同时存在**——Z.ai 就是既有钱包又有 Coding Plan，两样都读，任一边读不到也不影响另一边。

OpenCode Go 那条的"本机 `auth.json`"是个便利：路由上没配 `apiKeyEnv` 时，会去读 OpenCode 客户端自己存 key 的那个文件（`~/.local/share/opencode/auth.json`），key 只发回它本来的来处。文件不存在、读不动、格式变了，一律当作"没有凭据"，安静退回，不会因此报错。

这几家订阅接口都没有公开 schema。字段位置不对时，卡片会**说出它去哪儿找过**，而不是留一张空卡——那句话可以直接反馈给我们。

中转站跑的是哪套程序由路由指纹自动判定，第一次查余额时探测一次并记住。厂商自己的域名不需要探测——origin 直接决定用哪套读法，而且同一厂商的多条路由会合并成一个账户（一个钱包），这跟中转站正好相反。

New API 的额度是**按 key** 的：同一个站上两把 key 是两份额度，面板分别列出,配置用户中心 API 后，可展示余额。

Sub2API 的 `/v1/usage` 有三种形态，面板都认：key 配了总额度或速率限制的，读额度和 5 小时 / 每日 / 每周三个窗口；key 属于套餐分组的，读日/周/月周期；剩下的是钱包余额。**只有最后一种带 `balance` 字段**，所以前两种以前是一张空卡。

## 配置 / Configuration

当前 DSH 从 provider 的有效 Config 自动发现站点。旧版 `settings.yaml` 注册接口已移除，本分支使用插件 Config 和宿主 Settings 服务。

在账本页面顶部点击“设置”，或进入“插件 → 用量账本 Pro”的配置区。可编辑路由覆盖、模型费率、自定义余额端点三个 JSON 字段，保存带版本检查并实时生效。详细说明见 [账本设置](docs/SETTINGS.md)。

例如“路由覆盖”填写：

```json
{
  "my-route": "https://relay.example.com/v1"
}
```

模型费率使用数组；`null` 恢复默认费率行为。余额令牌通过余额卡片的“设置查询API”单独保存，不应填入这些 JSON 字段。

### 自己声明一个余额接口 / Declared endpoints

内置表覆盖不到的供应商，可以自己声明它的接口，不用等我们发版本：

在“自定义余额端点”字段中填写数组，例如：

```json
[
  {
    "origin": "https://relay.example.com",
    "displayName": "我的中转站",
    "path": "/api/quota",
    "fields": {
      "total": "data.balance",
      "granted": "data.total",
      "used": "data.used",
      "currency": "data.unit",
      "plan": "data.plan_name"
    },
    "windows": [
      { "kind": "weekly", "usedPercent": "data.week.percent", "resetsAt": "data.week.reset_at" }
    ]
  }
]
```

`origin` 必须与已配置的 provider 同源。有些接口需要裸令牌认证时可增加 `"raw": true`；此字段只选择认证形式，不接收密钥。

`fields` 和 `windows` 里写的是**取值路径**——描述"数字在哪儿"，不描述"怎么取"。没有表达式，也没有任何东西会被求值。路径写错只会让那个字段缺席，其余照常显示。

这个功能等于让配置文件决定"往哪儿发一个带密钥的请求"，所以边界写死在代码里，不靠自觉：

- **请求发往匹配到的那条 provider 的 origin**，`origin:` 字段只是用来找它的键。声明一个没配过的地址，不会产生任何请求。
- `path` 必须是**单斜杠开头的绝对路径**。`//host/x` 是协议相对 URL，会解析到别的主机上；构造完还会再校验一次 origin。
- **只发 GET**，没有请求体，声明里的 method / headers 一概不生效。
- **密钥仍然只从那条 provider 自己的 `apiKeyEnv` 取**，声明不能指定任何凭据。
- **跨源重定向直接失败**，不跟随——那是绕过第一条最省事的办法。
- **响应体有大小上限和超时**。
- **不能覆盖内置读法**：只在内置表答不上来时才轮到它。

这类卡片会标注「自定义端点」，因为数字是你自己配的路径取出来的——取错了是配置问题，界面得让这一点看得出来。

### 「未知路由」是什么

中转站分布里可能出现一行「未知路由」。它的意思是：**这些请求走的路由，现在的 provider 配置里找不到了**——改过名、删掉了，或者当时用的是另一台机器上的配置。

它和「直连/官方」是两件事，分开是刻意的：

- **直连/官方** = 这条路由配置着，而且不指向任何中转站，请求确实直接打到厂商
- **未知路由** = 我们**不知道**它去了哪

以前这两种合并成一个桶，结果是一台真实机器上 88% 的 token 显示成「直连/官方」，而其中很大一部分其实走了中转站。**把「读不到」显示成一个确定的答案，是这个项目在别处一直防着的错误，这里漏了一个口子。**

**数据没丢，只是标签错了。** 汇总行是按 `(sessionId, day, site, provider, model)` 存的，**路由名一直在**。把那条路由重新配回去（同名即可），目录变化会触发索引重建，历史流量自动归位。

## 按项目归属 / Per-project attribution

面板除了「按站点」「按模型」，还有一段「按项目」：这个月的钱，是哪个项目烧的。

**归组的键是会话启动时所在的目录**，不是宿主的工作区 id。这一条是刻意的：

DSH 的工作区（`ctx.workspace`）是**一个目录的登记**——`create(path)` 会先 `fs.realpath`，并且同一个规范路径只会有一条记录；会话是否属于它，判定是 `sessionPath(id) === record.path`，**严格相等**。所以一个工作区就是一个项目，它不是一个能装若干项目的容器。

按工作区 id 归组会无声地漏掉两类用量：

- **在子目录里起的会话**（`cd src && dsh`），cwd 和登记的路径不相等，谁也不属于；
- **从没在界面里登记过工作区的项目**，压根不存在。

这两类大概率是多数。所以：**按 cwd 归组，用工作区标题命名。** 跟中转站那条规矩是一个道理——站点按 `baseURL` 归一化出的 origin 分组，不按路由别名，因为叫 `deepseek` 的路由可能指向任何地方。**cwd 是实际发生的事，工作区标题是有人打的标签。**

没有 cwd 的会话单独一行标成「未记录目录」，**不会被丢掉**——不然按项目的几行加起来就对不上总数，而看的人无从察觉。

`workspace` 是**可选依赖**：组合里没挂这个服务，整段照常工作，只是每行显示目录名而不是工作区标题。

## 正确性与数据口径 / Correctness

用量折叠有三个地方容易错，都有测试覆盖（`test/usage.test.js`）：

**请求失败了照样扣费。** 用量除了挂在 `assistant/message` 上，也会从 `assistant/chunk` 的 `{type:'usage'}` 流出。请求在报出 usage 之后失败，就永远等不到 `assistant/message`——但供应商已经收钱了。只订阅 `assistant/message` 会系统性少算这部分。

**同一个 `(turn, step)` 会被报告两次。** 后来的样本是**替换**前一个，不是累加；替换时必须从**原先归属的那一天和那条路由**里减回去。

**孤儿 usage chunk 不带身份。** `assistant/message` 自带 provider 和 model，`StreamChunk` 的 usage 变体没有。失败请求那条记录要回退到最近一次 `request/header`，且要认得 `reason: 'resume'`（进程重启会重发 header，那不是换模型）。归不上的记为显式 `unknown`，绝不猜。

口径上：`inputTokens`、`cacheReadTokens`、`cacheWriteTokens` 三个桶**互斥**，相加才是计费输入；`reasoningTokens` 是 `outputTokens` 的**子集**，只做展示，加进总数就是重复计费。天按**宿主进程的本地时间**切分，面板上会标出是哪个时区。

归属在**折叠时**写死进记录，历史永不重写。中转站集合发生变化时会丢弃索引并全量重建——否则新认出的站会显示成"你刚开始用它"。

## 隐私与安全 / Privacy & security

- **从不读取内容。** 只有计数和标识符：token 数、模型名、provider 路由名、站点域名。提示词、工具参数、响应正文既不读也不存。
- **凭据处理。** provider 的 API key 在宿主侧通过 credentials 服务解析，用于余额请求，不进入用量数据库或查询响应。New API 的“设置查询API”将新凭据保存到宿主 credentials record，不再写入普通插件配置；页面只得到用户 ID 与令牌是否存在。旧版 `userAuth` 仅作只读兼容，删除前需清理仍存在的旧来源。
- **访问边界。** 当前 Desktop 和 Web 将接口注册到宿主 `connection.fetch`，由宿主的认证和 owner Peer 检查后分发；Desktop 使用 IPC carrier，不假设 HTTP 端口。旧宿主的 exact HTTP 回退仍校验回环 peer 与 Host，并在有宿主认证服务时执行认证。查询使用 GET，只有 `/api/tokenledger/userauth` 接受 POST 保存或清除用户中心凭据。
- **中转站指纹识别不用凭据**，靠路由的 404/401 特征。

## API

Desktop / Web 通过宿主认证通道使用以下逻辑端点；旧 HTTP 回退限制回环访问：

| 端点 | 说明 |
| --- | --- |
| `GET /api/tokenledger/usage?days=&site=` | 整个面板的数据：三窗口合计、按天/模型/站点、一年活跃度与逐日模型构成、账户列表、索引诊断 |
| `GET /api/tokenledger/balance?account=` | 某个账户的余额 |
| `GET /api/tokenledger/userauth?origin=` | 用户中心凭据的设置状态，仅含用户 ID 与令牌是否存在 |
| `POST /api/tokenledger/userauth` | 保存或清除宿主凭据库中的钱包查询记录 |
| `GET /api/tokenledger/settings` | 读取非敏感配置和 revision |
| `POST /api/tokenledger/settings` | 保存路由、费率、端点设置；过期 revision 返回 409 |

包也可作为库使用，供 DSH 之外的消费者：

```js
import { foldUsage, bySite, byModel } from "dsh-tokenledger-pro";
import { LedgerStore } from "dsh-tokenledger-pro/store";
import { readBalance } from "dsh-tokenledger-pro/balance";
```

### Harness 与 Blue

`ctx.tokenLedger` 为现有消费者保留原有对象身份和九个成员：`store`、`sweep`、
`totals`、`byDay`、`byModel`、`bySite`、`sites`、`diagnostics` 和 `reindex`。

Blue UI 与 Web UI 都包含在同一个 `dsh-tokenledger-pro` npm 包中。安装该 bundle 后：

- 普通 Harness/Web 环境保留原文本 `/tokenledger` 命令和回环 HTTP 面板。
- 检测到 Blue host 时，同一个插件 Fiber 挂载原生 dashboard，并以 Blue overlay
  命令替换文本命令；Blue 卸载或拒绝注册时恢复文本命令。
- Blue 通过 apply-local controller 读取同一个 `usagePayload()`，不会发布额外的
  Cordis Service，也不会维护第二套用量口径。

完整架构和验收记录见
[`docs/BLUE-MIGRATION.md`](docs/BLUE-MIGRATION.md)。

## 开发 / Development

```bash
npm ci --ignore-scripts
npm test          # 含浏览器半边——它能在 Node 里被物化和测试
npm pack --dry-run --json
```

浏览器半边**没有构建步骤**：它是一个手写的 `__ModuleLoader__` bundle，React 由宿主作为 peer 提供，样式手写注入。因此它能在 Node 里被加载和测试。

Blue PR 验收不需要 clone Blue 仓库。从本仓库根目录安装固定版本的 Blue
CLI，把当前插件快照加入它管理的 `blue` profile，然后启动：

```bash
npm install --global pnpm@11 @dsh-blue/blue-cli@0.1.2-alpha.1
blue plugin add "file:$PWD"
blue
```

进入 Blue 后执行 `/tokenledger`，检查真实用量、刷新、账户切换、分页和退出清理。
修改插件源码后，重新执行 `blue plugin add "file:$PWD"` 再启动；`file:` 安装会物化
插件自己的依赖闭包，不依赖开发者机器上的 TokenLedger 工作区链接。

## 致谢 / Credits

- OpenRouter、Moonshot/Kimi 与 Z.ai/GLM 的余额响应解析参考并改编自
  [`Ychris12138/dsh-usage-stats`](https://github.com/Ychris12138/dsh-usage-stats)（MIT）；TokenLedger
  在此基础上增加了按 origin 识别、账户归并、Management Key 提示和币种防猜，详见 [NOTICE](NOTICE)
- 热力图的分位数分级与悬停详情参考 [`xiufengsun/TokenTracker`](https://github.com/xiufengsun/TokenTracker)（MIT）
- New API 的计费口径读自 [`QuantumNous/new-api`](https://github.com/QuantumNous/new-api) 源码

## 友情链接 / Links

感谢 [LINUX DO](https://linux.do/) 社区的帮助与支持。

*Thanks to the [LINUX DO](https://linux.do/) community for their help and support.*

<details>
<summary>DSH 生态 / The DSH ecosystem</summary>

**宿主 / The host**

- [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) —— 本插件运行其上的 agent harness

**插件索引 / Where to find plugins** —— 这几处收录了社区插件，装之前值得先逛一圈

- [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) —— 按功能分类的中英双语列表
- [`AdamPlatin123/awesome-dsh-plugins`](https://github.com/AdamPlatin123/awesome-dsh-plugins) —— 自动扫描 `dsh-plugin` topic，带兼容性状态列
- [`0xsline/awesome-deepseek-harness`](https://github.com/0xsline/awesome-deepseek-harness) —— 人工精选，另有自动生成的 `CATALOG.md`
- [`bruc3van/awesome-dsh-plugin`](https://github.com/bruc3van/awesome-dsh-plugin) —— 场景导航、入门套装与热度榜

**这个面板读得懂的上游 / Upstreams this panel reads**

- [`QuantumNous/new-api`](https://github.com/QuantumNous/new-api) —— 中转站程序；面板的额度换算口径是从它的路由与计费源码里读出来的

</details>

> **非官方声明**：DSH TokenLedger Pro 是基于 TokenLedger 的独立第三方二次开发项目，不代表上游作者的维护、赞助或背书，与 DeepSeek 无隶属、赞助或背书关系。原作者与第三方项目的版权和致谢予以保留。以上友链亦不代表任何隶属、赞助或背书关系。「DeepSeek」及相关商标归其权利人所有。

## License

本项目继续采用 [MIT License](LICENSE)。上游 TokenLedger 的版权声明与 MIT 许可文本保持保留，本分支的修改由 SherryXXX8043 和 DSH TokenLedger Pro 贡献者按同一许可证提供。第三方来源与归属见 [NOTICE](NOTICE)。
