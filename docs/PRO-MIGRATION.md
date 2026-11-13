# DSH TokenLedger Pro：版本与迁移

## 当前版本

本分支从 TokenLedger 提交 `438d3086249d427e7185a69c5453cb1553c84f0b` 建立，使用独立版本 `0.1.0-pro.0`。这是开发预发布版本，版本号不与上游比较大小；目前的改动为项目归属、包标识、索引隔离及开发验证修复，没有新增业务功能或供应商适配。

本仓库通过 GitHub 管理和分发源码，设置包名不代表已经发布至 npm，也不代表已验证 npm 名称可用性。后续新增功能、适配与修复记录在根目录 CHANGELOG.md 中。

| 项目 | 原版 | Pro 分支 |
| --- | --- | --- |
| 仓库 | zh667/TokenLedger | SherryXXX8043/dsh-TokenLedger-pro |
| 包名 / Web 模块 / Blue manifest id | dsh-tokenledger | dsh-tokenledger-pro |
| Cordis 加载行 id | tokenledger | tokenledger-pro |
| 默认 SQLite 索引 | tokenledger.sqlite | tokenledger-pro.sqlite |
| 命令 | /tokenledger | /tokenledger（兼容保留） |
| settings 命名空间 | tokenledger | tokenledger（兼容保留） |
| Host 服务 | ctx.tokenLedger | ctx.tokenLedger（兼容保留） |
| HTTP 路径前缀 | /api/tokenledger | /api/tokenledger（兼容保留） |

**同一 profile 内只能启用其中一个版本。** 独立包名与索引文件并不意味着两个版本可以同时运行；保留的命令、服务和接口名称仍会冲突。

## 从原版切换

1. 记录原版安装来源、完整提交或版本、使用的 profile，以及自定义的 `tokenledger` 配置。
2. 在修改安装状态前，停止对应的 DSH 进程，再备份该 profile 的配置和实际使用的 SQLite 索引。若 SQLite 的 `-wal` / `-shm` 文件仍存在，一并保留。配置可能包含凭据，备份仅放在受保护的本地位置，不要提交到 Git。
3. 在 DSH 的插件管理中停用或移除原版 `dsh-tokenledger`。使用 CLI 时，移除命令为：

   ```sh
   dsh plugin --profile web remove dsh-tokenledger
   ```

4. 安装 Pro 分支：

   ```sh
   dsh plugin --profile web add "github:SherryXXX8043/dsh-TokenLedger-pro"
   ```

   `web` 是示例 profile，应使用实际运行的 profile。需要固定源码时，使用本仓库存在的完整 40 位提交 SHA。

5. 检查原来的 `tokenledger` 配置。该命名空间继续保留，但如果配置中显式指定了原版数据库路径，需要为 Pro 改成一个新的索引路径，否则显式配置会覆盖默认值，仍可能打开旧索引。
6. 重启原有 DSH 并硬刷新浏览器。Pro 默认从宿主持久会话日志重建自己的索引，无需复制或修改旧索引。只有宿主中仍保留的日志能被重建；旧索引含有已删除会话的历史汇总时，应先从原版导出 CSV / JSON 留档。本分支目前不提供旧汇总导入功能。
7. 执行 `/tokenledger diagnostics`，检查索引、归因和扫描失败数，核对代表性项目与模型的用量，并实际查看余额卡片。测试通过不等于真实供应商接口和 DSH / Blue 界面已经验收。

迁移应在需要时由用户实际执行；本次开发没有更改当前 profile、安装插件或修改用户数据库。

## 回退

停止 DSH，停用或移除 `dsh-tokenledger-pro`，重新安装先前记录的原版版本。使用备份的配置及原版索引；不要直接用 Pro 索引覆盖原版索引。Pro 默认使用单独的索引文件，原版数据可独立保留。重启后检查原版面板和诊断。

## 本地开发与验收

需要 Node.js >= 22，并使用包含 npm 的 Node.js 安装。在仓库根目录执行：

```sh
npm ci --ignore-scripts
npm test
npm pack --dry-run --json
```

依赖按锁文件安装，禁用安装生命周期脚本。常规测试覆盖领域逻辑、Web 注册和 Blue 适配的模拟环境；真实 DSH / Blue 安装、界面显示及供应商余额接口另行验收。需要 Blue 源码的独立安装 fixture 是可选集成检查，其环境要求见 BLUE-MIGRATION.md，不能把未运行的 fixture 记作验收通过。

## 上游同步

`origin` 指向本项目，`upstream` 指向原作者项目。后续按需评估并合入上游变更，保留来源与许可；向原作者提交合并请求不属于本项目默认发布流程。上游历史文档中的验收记录和 registry 示例只代表原项目当时的结果，不代表 Pro 分支已获同等验证。
