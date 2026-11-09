# dsh-skill-pilot

DeepSeek Harness（DSH Desktop）输入框旁的**技能领航员**：一个按钮打开中文技能面板，同时根据你正在写的草稿主动推荐该用哪个技能。

装好之后，输入框左侧会出现「🧩 技能」按钮。

## 它解决什么

DSH 自带 `/` 命令面板列出技能时，只有名字和一段英文长描述——几十个技能看下来一大坨，很难判断"这个技能到底是干什么的、我现在该不该用"。

dsh-skill-pilot 做两件事：

1. **中文一句话说明**：把每个技能的中文用途浓缩到一行，按类别分组，可搜索。
2. **跟着草稿推荐**：你写"帮我把这个 Word 文档的表格整理一下"，推荐条会浮出 `office-docx`；写"给这篇论文降重"，浮出 `humanizer` / `writing-guard`。点一下就把 `/技能名 ` 插进输入框。

## 特性

- 🗂 **按类别分组**：论文科研 / 代码开发 / 文档表格 / 数据图表 / 检索抓取 / 集成接入 …… 长列表也能扫得动
- 🔍 **中英混合搜索**：技能名、中文说明、英文描述、分类都能命中
- ✨ **输入即推荐**：草稿停顿 250ms 后排序推荐（带防抖，中文输入法不会闪烁）
- 🇨🇳 **全部本地生成**：中文说明由本地规则与技能文件里的中文原句合成，**不联网、不调模型、不外传任何内容**
- ⚡ **零原生依赖**：纯 JS，无 onnxruntime / sharp 等需要编译的依赖
- 🔁 **可刷新**：面板底部「刷新目录」重新扫描，新装技能立即可见

## 安装

```bash
dsh plugin install dsh-skill-pilot
```

或在 DSH 插件市场搜索 `skill-pilot`。装完**完全退出并重启** DeepSeek Harness。

手动装也简单——在你的 profile 目录（通常是 `~/.dsh/profiles/desktop`）执行：

```bash
pnpm add -w --save-exact dsh-skill-pilot
```

然后把它加进 `package.json` 的 `dsh.profile.bundles` 末尾：

```json
"bundles": [ "...", "dsh-skill-pilot" ]
```

## 使用

- 点「🧩 技能」→ 面板打开。没搜索时按类别分组；输入关键词就变成扁平结果。
- 点任意一行 → `/技能名 ` 自动插入输入框，继续补你的话即可。
- 直接开始打字 → 输入框上方出现推荐条，最多 3 个，点一下即插入。
- 想跳过某个推荐？忽略就行，它不拦路、不自动执行任何东西。

## 技能从哪来

按优先级扫描以下位置（同名技能先命中者胜）：

| 来源 | 路径 |
| --- | --- |
| DSH 用户技能 | `$DSH_HOME/skills` |
| Agent 技能 | `~/.agents/skills` |
| CodeBuddy | `~/.codebuddy/skills` |
| WorkBuddy | `~/.workbuddy/skills` |
| Claude | `~/.claude/skills` |
| 内置 / 插件 | DSH 技能服务注册的条目 |

每个技能的说明取 `SKILL.md` frontmatter 的 `description`，若其中已含中文则直接采用；否则用内置关键词表合成一行中文类别提示。

## 技术说明

两个半边：

- **host**（`lib/index.js`）：注册两条只读 HTTP 路由
  - `GET /api/skill-pilot/index` — 技能目录（30 秒缓存）
  - `GET /api/skill-pilot/rebuild` — 强制重扫
- **client**（`lib/client.js`）：注入 `conversation.input.left` 插槽，渲染按钮、面板与推荐条

基于 `webServer` 与 `skills` 两个核心服务，无其他运行时依赖。

## License

MIT © 杨靖
