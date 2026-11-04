# Tangyixiao DSH Plugin Market

独立维护的 DeepSeek Harness format 1 插件索引，聚合公开市场的安装记录，并保留本仓库维护的精确 npm 版本。市场清单、来源顺序、构建和部署均由本仓库控制。

## 订阅

[https://tangyixiao.github.io/dsh-plugin-market/index.json](https://tangyixiao.github.io/dsh-plugin-market/index.json)

在 DSH「插件 → 实验性插件」中开启「自定义插件市场」，进入「发现 → 添加索引源」，粘贴完整地址。安装前在 DSH 确认包名、精确版本、registry 或固定 Git commit，以及兼容范围。

入口页展示最近一次构建的实际插件数、版本数及来源；[sources.json](https://tangyixiao.github.io/dsh-plugin-market/sources.json) 保留抓取时间、原始响应 SHA-256、来源归属、每个版本的选择、冲突和原始验证声明。来源收录和格式解析通过不代表本市场安装或沙箱测试过这些插件。

需要明确选用预览版本时，单独订阅 [preview/index.json](https://tangyixiao.github.io/dsh-plugin-market/preview/index.json)。它读取 `preview.market.json`，通过 `allowPrerelease: true` 允许维护者填写精确预览版本；主配置和主订阅中的自有稳定 pin 保持独立。预览频道优先收录 Bridge `0.6.0-community.5` 和 WorkBuddy 社区版 `0.1.7-rc5.2`，并合并相同四个上游来源中的已有版本。官方解析器按 SemVer 排序，预览频道中的高版本候选可能排在旧稳定版前，因此仅在明确接受预览时订阅。

WorkBuddy 社区版通过其原仓库的固定 Git commit 安装，索引没有把 GitHub Release 附件冒充为 npm 包。构建只读核对公开 Release 的发布时间、标签解析到的精确 commit、该 commit 的包清单和构建入口/补丁文件。其 GitHub Release tarball 仍可按发布说明手动安装。ZCode Community Retry 是原生 ZCode 插件，见 [Retry 0.3.2 发布页](https://github.com/tangyixiao/dsh-zcode-plan-bridge/releases/tag/zcode-community-retry-v0.3.2)，不会作为 DSH 安装记录收录。

## 来源与优先级

`market.json` 的 `plugins` 是自有精确稳定版本 pin；`upstreamSources` 是公开 format 1 源，数组靠前者优先。当前配置按以下顺序导入：

| 来源 | 公开索引 | 原站与数据条款 |
| --- | --- | --- |
| Awesome DSH Plugin | [index.json](https://awesome-dsh-plugin.com/index.json) | [原站](https://awesome-dsh-plugin.com)；目录 [CC0-1.0](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/LICENSE) |
| Open Plugin Market | [index.json](https://dshopen.org/index.json) | [原站](https://dshopen.org)；目录仓库 [GPL-3.0](https://github.com/polang233/dsh-plugin-index/blob/main/LICENSE) |
| DSH Marketplace | [index.json](https://dshmarketplace.dev/market/index.json) | [原站](https://dshmarketplace.dev)；[API 条款](https://dshmarketplace.dev/api-docs)允许数据使用，包括商业使用，建议保留出处 |
| DSH Plugin Hub | [index.json](https://dpharness.com/market/index.json) | [原站](https://dpharness.com)；[API](https://dpharness.com/api-docs)欢迎聚合并要求署名；[网站条款](https://dpharness.com/terms)对原创翻译和验证信息要求非商业转载、注明出处及原文链接 |

构建保留来源提供的 author、repository、homepage 与安装地址。一个插件的展示信息采用优先来源；溯源报告保留每个来源的原记录和原文地址。索引中的各插件仍适用原作者许可证；本仓库不把上游目录数据或插件统一改授 AGPL 或 CC0。Hub 数据的非商业和署名要求继续适用，本市场对其来源和原文链接予以保留。

同名插件合并全部公开有效版本。同名同版本发生安装目标、兼容字段或发布时间冲突时，采用优先来源的**整条版本记录**，并把被舍弃的完整记录与原目标写入报告；不会将一个来源的 npm/Git 地址和另一个来源的兼容范围拼在一起。自有 pin 对同一版本的目标和兼容字段始终优先。合并后的版本仍按官方 SemVer 排序，自有 pin 不承诺永远是列表首项。

分类、标签和排序键统一加 `upstream:<source-id>:` 命名空间，显示标题也标明来源。每个插件带官方格式支持的 `source:<id>` 来源标签。审查、沙箱、实装和兼容类声明只在该来源完整覆盖合并后的全部版本，且每个版本的最终安装目标与兼容字段都一致时保留；否则只在报告中保留原标签与其精确版本，避免把旧版本验证扩成对整个插件的背书。`verified`、`sandbox-*`、`static-checked`、`next/alpha` 安装结果、`older-release` 及对应审查/安装/兼容用词均按此规则处理。普通分类和能力标签正常合并。

另参考了 [DSHPlugin Store](https://www.dshplugin.store/) 的公开目录。它的目录记录没有 format 1 所需的精确 npm 版本或固定 Git commit，本市场不据此推断安装地址，因此未将这些目录记录转成安装条目。

## 配置与构建

编辑 `market.json` 的 `upstreamSources` 可调整公开源和优先级；每项包括唯一 `id`、`title`、HTTPS `url`，以及原站 `homepage`、数据 `license`、`licenseUrl` 等说明。保留来源数据本身的许可要求。所有配置会在网络请求之前验证。

自有 pin 继续使用以下格式：

```json
{
  "name": "dsh-zcode-plan-bridge",
  "version": "0.5.2",
  "repository": "https://github.com/tangyixiao/dsh-zcode-plan-bridge",
  "title": "ZCode Plan Bridge"
}
```

先发布目标稳定版本到公开 npm，再更新 pin。构建读取实际发布时间、作者与顶层 `engines.dsh`；不会用构建时间替代发布时间、回退到旧 `latest` 或自行选择预览版本。上游已明确列出的有效版本，包括其预发布版本，按原记录保留。

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm test
npm run build
npm run build:preview
```

需要 Node.js 24+。输出为 `dist/index.json`、`dist/sources.json`、`dist/summary.json` 和 `dist/index.html`。入口页仅读取小型 `summary.json` 统计，完整审计报告按需打开。所有输入先用固定版本 `@deepseek-ai/dsh-plugin-market-index` 按**原索引 URL**解析，保留原安装目标并将相对图标转为原站绝对地址；聚合结果再次通过官方解析器。构建仅读取公开元数据，不下载、安装或运行所收录插件。

预览频道输出在 `dist/preview/`，同样生成上述四个文件。可用 `node scripts/generate.mjs --config preview.market.json --out dist/preview/index.json` 显式选择配置与输出。默认命令仍只构建稳定频道，不自动选择 npm dist-tag 或预览版本。单个包仍只配置一个精确 pin；多来源已有版本由现有聚合步骤合并。

每个响应默认最多 32 MiB，超时 15 秒，最多 3 次请求。可使用 `MARKET_FETCH_MAX_BYTES`（1–67108864）、`MARKET_FETCH_TIMEOUT_MS`（1–60000）、`MARKET_FETCH_ATTEMPTS`（1–10）及 `MARKET_RETRY_DELAY_MS`（0–60000）调整边界。上游临时网络/429/5xx 故障有界重试，非法 JSON/格式直接失败；npm pin 继续只对未传播的版本重试。

任意配置、来源抓取或校验失败都会阻止完整构建，不静默漏掉失败源。所有文件先写入独立 staging 目录，保留输出目录中的其他文件和图标资产，最后交换整个受管目录；交换失败会恢复旧目录，避免旧索引配上新来源报告。文件系统根目录、工作区或配置目录的祖先、主目录和符号链接输出目录会被拒绝。`index.json` 对同样的来源响应保持确定性；报告中的真实抓取/生成时间会变化，报告同时记录索引 SHA-256。

## 发布与维护

`main` 的提交和 Actions 手动运行会执行测试，再完整构建稳定和预览两个频道，两者均通过后才部署 Pages；PR 仅测试和构建，不部署。每次构建重新读取全部配置源，能够纳入这些来源新公开的条目和版本；这次不新增定时任务。自有 pin 需要明确更新配置，其他仓库发布 npm 不会自动替换 pin。

本地构建和 PR 校验不会改变线上站点。只有经过合并并成功完成部署，订阅地址才会更新。

## 许可证

索引构建工具按 [AGPL-3.0](LICENSE) 发布。上游目录、原创说明及插件分别保留其原许可证或网站条款；出处和原文地址见上表与生成的溯源报告。源码许可证不替代上游内容的授权范围。
