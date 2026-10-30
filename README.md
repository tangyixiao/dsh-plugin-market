# Tangyixiao DSH Plugin Market

独立维护的 DeepSeek Harness 插件市场索引，使用 DSH 官方 format 1 格式。市场清单、版本选择、构建和部署均在本仓库维护。

## 订阅地址

[https://tangyixiao.github.io/dsh-plugin-market/index.json](https://tangyixiao.github.io/dsh-plugin-market/index.json)

在 DSH「插件 → 实验性插件」中开启「自定义插件市场」，进入「发现 → 添加索引源」，粘贴上面的完整地址。安装确认页会显示精确的 npm 包名、版本及 registry。

当前首个条目是 [ZCode Plan Bridge](https://github.com/tangyixiao/dsh-zcode-plan-bridge) `0.5.2`。该市场由 tangyixiao 维护；每个插件的作者、许可证和兼容范围仍以各自的发布包为准。

## 添加或更新条目

编辑根目录的 `market.json`，为每个插件填写 npm 包名、精确稳定版本、源码仓库地址和展示标题。可以添加多个插件，每个包名保留一个选定版本，例如：

```json
{
  "title": { "en": "Tangyixiao DSH Market", "zh": "Tangyixiao DSH 插件市场" },
  "plugins": [
    {
      "name": "dsh-zcode-plan-bridge",
      "version": "0.5.2",
      "repository": "https://github.com/tangyixiao/dsh-zcode-plan-bridge",
      "title": "ZCode Plan Bridge"
    }
  ]
}
```

先将目标版本发布到公开 npm registry，再更新市场清单。构建从 npm 读取实际发布时间、作者、介绍及顶层 `engines.dsh`，不会用构建时间代替发布时间，也不会回退到旧的 `latest` 或混入预览版。

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm test
npm run build
```

需要 Node.js 24 或更高版本。生成结果位于 `dist/index.json`，并通过固定版本的官方 `@deepseek-ai/dsh-plugin-market-index` 校验器验证。构建只读取公开发布元数据，不安装或执行所收录插件。

## 发布

提交到 `main` 后，`Publish plugin market` 工作流运行测试、生成索引，附上最小入口页，再部署 GitHub Pages。也可以在 Actions 中手动运行工作流。PR 只运行校验，不部署。

缺少目标版本、身份不匹配、无效兼容范围或其他校验失败都会阻止发布，已有线上索引保持原样。npm 元数据传播延迟只进行有界重试。更新订阅内容需要更新本仓库清单并提交，或手动重新构建；发布其他仓库的 npm 包不会自动修改这里选定的版本。

## 许可证

索引构建工具按 AGPL-3.0 发布，见 [LICENSE](LICENSE)。所收录插件保留各自作者与许可证。
