// dsh-skill-pilot — host process half.
//
// Publishes one JSON index the browser half renders:
//
//   GET /api/skill-pilot/index    -> { stamp, total, builtAt, entries: [...] }
//   GET /api/skill-pilot/rebuild  -> same, after dropping the memoised copy
//
// Every Chinese note is produced on this machine: the skill's own frontmatter
// is preferred when it already carries a Chinese clause, then the body, then a
// hand-written table for skills shipped with DSH Desktop, and only as a last
// resort a category noun derived from an English keyword table. No network, no
// model call, and `noteFrom` always records which of those four won so the UI
// can mark a synthesised note apart from an authored one.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Plugin row id used by the bundle patch. */
export const name = "skill-pilot";

/** Host services that must be up before the routes can mount. */
export const inject = ["webServer", "skills"];

/** Endpoints, kept in one place so the browser half can mirror them. */
const ENDPOINT = {
  index: "/api/skill-pilot/index",
  rebuild: "/api/skill-pilot/rebuild",
};

/** Stamped into every payload; the browser half warns when it drifts. */
const STAMP = "2026.11.06";

/** How long a built index stays warm, in milliseconds. */
const WARM_MS = 30_000;

/** Longest Chinese note the panel can render without clipping. */
const NOTE_LIMIT = 90;

//#region hand-written notes

/**
 * Authored one-liners for skills that ship with DSH Desktop, keyed by skill
 * name. These are the entries a user meets on their first run, so they get a
 * real sentence instead of a keyword noun.
 */
const AUTHORED_NOTES = {
  "academic-paper": "学术论文写作流水线：12 个 agent、11 种模式，支持 6 种论文类型与 5 种引用格式",
  "academic-paper-composer": "按优化后的大纲逐章写成投稿级稿件，含章节间一致性检查",
  "academic-paper-reviewer": "多视角同行评审：期刊匹配 + 三个同行角色 + 魔鬼代言人",
  "academic-paper-strategist": "选题策划：研究缺口识别、原创性评估、大纲优化、预印本要求",
  "academic-pipeline": "全流程编排：选题→写作→检查→评审→修订→定稿，共 10 个阶段",
  "arxiv-research": "检索 arXiv 论文、分析内容、构建文献综述、生成引用",
  "deep-research": "深度研究：13 个 agent、8 种模式（完整研究/快速简报/论文评审/综述等）",
  "research-writer": "研究报告：整理研究问题、证据、来源、判断与风险，产出可编辑报告",
  "research-writing-skill": "中文科研写作：正文、摘要、引言、方法、结果、讨论、审稿回复",
  "writing-guard": "论文写作审计与 Word 安全编辑：去 AI 腔、删冗余、核对表格",
  "innovation-point": "按卷积网络论文范式撰写 Methods 章节",
  "office-docx": "Word 文档：创建、读取、编辑、检查 .docx，含表格与格式化",
  "office-pptx": "PowerPoint：创建、读取、编辑、检查 .pptx，含文本、表格、图片、图表",
  "office-xlsx": "Excel：读取、创建、修改 .xlsx，含数据、公式、格式化和分析",
  "office-academic-skill": "中文学术 Word/PPT：论文阅读报告、组会 PPT、可编辑文档",
  "gov-doc-writing": "公文写作：按单位、文种、角色和材料生成通知、报告、请示",
  "meeting-recap": "会议纪要：整理议题、讨论、决议、行动项、负责人和截止日期",
  "work-report-writer": "工作汇报：日报、周报、月报与阶段总结，核对交付与数字",
  "data-viz-gen": "据数据类型和业务问题选图表并标注",
  "dataset-health-audit": "数据质量审计：缺失、异常、单位、口径、重复与可复现性",
  "scientific-toolkit-skill": "科研计算工具箱：MATLAB/Python、信号与图像处理、统计、仿真、优化",
  "humanizer": "去 AI 腔：把机器味文字改写成自然的人话，只改说法不改内容",
  "generate-image": "生成照片、插画和背景图，用于演示文稿与文档",
  "diagnose-windows-sandbox-acl": "排查 Windows 下 DSH 沙箱权限拒绝，检查并修复路径 ACL",
  "hindsight-coding-agent": "Hindsight 记忆系统：如何存储/检索项目记忆、配置知识页面",
  "saas-metrics-coach": "经营指标：核对收入、MRR、客户留存、增长假设与计算口径",
  "defuddle": "从网页提取正文内容，去掉导航与广告",
  "excalidraw-skill": "画示意图、流程图与架构图",
  "ui-ux-pro-max": "UI/UX 设计与前端界面评审",
  "webapp-testing": "Web 应用端到端测试",
  "web-design-reviewer": "网页设计评审",
  "kaggle-learner": "Kaggle 竞赛学习与实践",
  "math-reasoning": "数学推理与证明",
  "code-review-excellence": "代码评审规范与实践",
  "bug-detective": "缺陷定位与排查",
  "git-workflow": "Git 工作流与分支管理",
  "planning-with-files": "用文件做任务规划与跟踪",
  "skill-development": "开发新的 DSH 技能",
  "skill-improver": "改进现有技能质量",
  "skill-quality-reviewer": "技能质量评审",
  "mcp-integration": "接入 MCP 服务",
  "code-reviewer": "审查文件夹内代码：规范、Bug、性能、可读性与评分",
  "code-review-before-modify": "改代码前强制走分析-方案-确认-执行流程",
  "test-driven-development": "先写测试再写实现（TDD）",
  "vue-best-practices": "Vue 组合式 API 与 TypeScript 最佳实践",
  "vue-debug-guides": "Vue 3 运行时错误、警告、异步与 SSR 排查",
  "vue-pinia-best-practices": "Pinia 状态管理与组合式 store 模式",
  "vue-router-best-practices": "Vue Router 4 路由与生命周期模式",
  "vue-mobile-breakage-fix": "修 Vue3 + Ant Design Vue 后台的移动端破相",
  "uniapp-expert": "uni-app 跨平台开发与 Vue2→Vue3 迁移",
  "miniapp-weaknet-race-guard": "修弱网下 Pinia/Vuex 旧请求覆盖新数据的竞态",
  "frontend-design": "做有设计感的前端界面、组件与页面",
  "impeccable": "高质量前端界面与视觉细节打磨",
  "diagram-builder": "架构图、流程图、时序图、状态机、ER 图",
  "office": "Office 文档、表格、演示与 PDF 的创建/编辑/转换总入口",
  "office-render": "把文档渲染成图片检查视觉版面",
  "office-export-pdf": "用 LibreOffice Kit 把 Office 文档导出 PDF",
  "office-recalculate": "刷新表格公式缓存并核对计算结果",
  "xlsx": "Excel 全流程：建表、公式、图表、透视表、清洗、条件格式",
  "obsidian": "操作 Obsidian 库并用 obsidian-cli 自动化",
  "github": "用 gh 命令操作 GitHub 的 issue、PR、CI 与查询",
  "github-mcp": "用 GitHub MCP 服务浏览仓库、管理 PR、监控 CI",
  "mcporter": "用 mcporter 命令管理并调用 MCP 服务",
  "tencent-news": "腾讯新闻搜索、热榜、天气、赛事与高考数据",
  "ima-skills": "IMA 知识库与笔记管理、搜索、上传",
  "wechat-cover": "公众号爆款封面设计与生图方案",
  "java-expert": "Java 源码分析、走读、生成、重构与 Spring 生态",
  "fullstack-companion": "自动识别项目类型并路由到对应开发流程",
  "create-adaptable-composable": "写工业级可复用 Vue composable",
  "figma": "用 Figma MCP 取设计上下文并转成代码",
  "mastergo-vibe-connect": "修复 MasterGo 设计稿读取连接失败",
};

/**
 * English keyword → category noun, tried in order so a specific bucket always
 * beats a general one. Only used when nothing Chinese could be found.
 */
const CATEGORY_RULES = [
  { test: /docx|pptx|xlsx|powerpoint|spreadsheet|power\s*point|word\s*document/i, noun: "文档表格" },
  { test: /paper|thesis|academic|journal|manuscript|citation|latex|预印本/i, noun: "论文科研" },
  { test: /research|literature|survey|peer[\s-]*review/i, noun: "研究综述" },
  { test: /\b(code|refactor|review|typescript|javascript|python|java|vue|react|pinia|composable)\b/i, noun: "代码开发" },
  { test: /test|debug|bug|diagnos|troubleshoot|profil|perf/i, noun: "测试排查" },
  { test: /git|commit|branch|merge|deploy|ci\b|github/i, noun: "版本发布" },
  { test: /chart|viz|graph|plot|dashboard|metric|statistic|diagram/i, noun: "数据图表" },
  { test: /image|photo|illustration|draw|design|canvas|cover|paint/i, noun: "图像设计" },
  { test: /write|writing|rewrite|polish|edit|tone|summar/i, noun: "写作润色" },
  { test: /meeting|report|memo|slide|presentation/i, noun: "汇报材料" },
  { test: /search|fetch|scrape|crawl|browse|web|news/i, noun: "检索抓取" },
  { test: /mcp|plugin|extension|integrat|connect|cli\b/i, noun: "集成接入" },
  { test: /office|pdf|document/i, noun: "办公文档" },
];

/**
 * Category pinned by name for skills whose English description points at the
 * wrong bucket. A curated pin always wins over CATEGORY_RULES.
 */
const PINNED_CATEGORY = {
  "frontend-design": "图像设计",
  "impeccable": "图像设计",
  "wechat-cover": "图像设计",
  "diagram-builder": "数据图表",
  "vue-mobile-breakage-fix": "测试排查",
  "mcporter": "集成接入",
  "github-mcp": "集成接入",
  "mastergo-vibe-connect": "集成接入",
  "figma": "集成接入",
  "obsidian": "笔记知识库",
  "ima-skills": "笔记知识库",
  "tencent-news": "检索抓取",
  "code-reviewer": "测试排查",
  "code-review-before-modify": "测试排查",
  "miniapp-weaknet-race-guard": "测试排查",
  "vue-debug-guides": "测试排查",
  "fullstack-companion": "代码开发",
  "uniapp-expert": "代码开发",
  "xlsx": "文档表格",
  "office": "办公文档",
  "office-docx": "办公文档",
  "office-pptx": "办公文档",
  "office-xlsx": "文档表格",
  "office-render": "办公文档",
  "office-recalculate": "文档表格",
  "office-export-pdf": "办公文档",
};

//#endregion

//#region text helpers

/** True when the string holds at least one Han code point. */
function containsHan(value) {
  const text = value === null || value === undefined ? "" : String(value);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) return true;
    if (code >= 0x3400 && code <= 0x4dbf) return true;
  }
  return false;
}

/** Trim to `limit` characters, marking the cut with an ellipsis. */
function shorten(text, limit) {
  return text.length > limit ? text.slice(0, limit) + "…" : text;
}

/**
 * First clause of `text` that is written in Chinese. Walks code points so a
 * surrogate pair is never split, and gives up quietly when the text has none.
 */
function leadChineseClause(text, limit) {
  const source = text === null || text === undefined ? "" : String(text);
  if (source === "") return "";
  let buffered = "";
  for (const glyph of source) {
    buffered += glyph;
    if ("。！？!?；;".includes(glyph) === false) continue;
    const clause = buffered.trim();
    if (containsHan(clause)) return shorten(clause, limit);
    buffered = "";
  }
  const tail = buffered.trim();
  return tail !== "" && containsHan(tail) ? shorten(tail, limit) : "";
}

/** Category noun for one skill, curated pin first, keyword rules second. */
function categoryNoun(skillName, ...haystack) {
  const pinned = PINNED_CATEGORY[skillName];
  if (pinned !== undefined) return pinned;
  const hay = haystack.filter((part) => typeof part === "string" && part !== "").join(" ");
  if (hay === "") return "";
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(hay)) return rule.noun;
  }
  return "";
}

//#endregion

//#region reading SKILL.md

/**
 * Split a SKILL.md file into frontmatter pairs and the remaining body in one
 * pass. Handles the two shapes that actually appear in the wild: a leading
 * `---` fence holding `key: value` pairs, and the same fence plus indented
 * continuation lines for block scalars (`description: >` and friends).
 */
function readFrontmatter(raw) {
  const source = String(raw === null || raw === undefined ? "" : raw).replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/);
  const pairs = new Map();
  const fence = "---";

  if (lines.length === 0 || lines[0].trim() !== fence) {
    return { pairs, body: source };
  }

  let cursor = 1;
  let openKey = "";
  let openValue = [];

  const commit = () => {
    if (openKey === "") return;
    pairs.set(openKey, openValue.join(" ").replace(/\s+/g, " ").trim());
    openKey = "";
    openValue = [];
  };

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim() === fence) break;
    if (line.trim() === "") continue;
    // An indented line continues the value opened by the previous key.
    if (/^\s/.test(line) && openKey !== "") {
      openValue.push(line.trim());
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    commit();
    const key = line.slice(0, colon).trim();
    if (key === "") continue;
    const rest = line.slice(colon + 1).trim();
    // Block scalar markers: the value lives on the following indented lines.
    if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
      openKey = key;
      openValue = [];
      continue;
    }
    pairs.set(key, unwrapScalar(rest));
  }
  commit();

  return { pairs, body: lines.slice(Math.min(cursor + 1, lines.length)).join("\n") };
}

/** Drop one layer of matching quotes around a YAML scalar. */
function unwrapScalar(value) {
  const text = value.trim();
  if (text.length < 2) return text;
  const head = text.charAt(0);
  const tail = text.charAt(text.length - 1);
  if ((head === '"' && tail === '"') || (head === "'" && tail === "'")) return text.slice(1, -1);
  return text;
}

/** First non-blank value among `keys`, or an empty string. */
function pick(pairs, ...keys) {
  for (const key of keys) {
    const value = pairs.get(key);
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/** Modification time of a file, or 0 when it cannot be read. */
function stampOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Build one index entry from a skill directory. Returns null when the directory
 * holds no SKILL.md, so a caller can treat "not a skill" and "unreadable skill"
 * the same way.
 */
function describeSkill(directory, fallbackName, origin) {
  const file = join(directory, "SKILL.md");
  if (existsSync(file) === false) return null;

  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }

  const { pairs, body } = readFrontmatter(raw);
  const skillName = pick(pairs, "name") || fallbackName;
  const english = pick(pairs, "description");
  const whenToUse = pick(pairs, "when_to_use", "whenToUse");

  // Note precedence: authored table, Chinese already in the file, then nothing.
  let note = AUTHORED_NOTES[skillName] || AUTHORED_NOTES[fallbackName] || "";
  let noteFrom = note === "" ? "" : "authored";
  if (note === "") {
    note = leadChineseClause(english, NOTE_LIMIT);
    if (note !== "") noteFrom = "frontmatter";
  }
  if (note === "") {
    const prose = body.replace(/^#+\s.*$/gm, "").slice(0, 4000);
    note = leadChineseClause(prose, NOTE_LIMIT);
    if (note !== "") noteFrom = "body";
  }

  const category = categoryNoun(skillName, english, whenToUse);

  if (note === "") {
    note = english === "" ? "" : shorten(english, NOTE_LIMIT);
    noteFrom = note === "" ? "none" : "english";
  }

  return {
    name: skillName,
    description: english,
    hint: category,
    zh: note,
    zhSource: noteFrom,
    whenToUse: whenToUse.slice(0, 200),
    source: origin,
    path: file,
    modelInvocable: pick(pairs, "disable-model-invocation") !== "true",
    mtime: stampOf(file),
  };
}

//#endregion

//#region discovering roots

/**
 * Labels applied to a scanned root, matched in order. The first signature whose
 * fragment appears in the normalised path decides the label.
 */
const ORIGIN_SIGNATURES = [
  [".claude/skills", "claude-skills"],
  [".codebuddy/skills", "codebuddy-skills"],
  [".workbuddy/skills", "workbuddy-skills"],
  ["office-runtime", "bundled"],
  ["/node_modules/", "bundled"],
  ["/.dsh/skills", "user-dsh"],
  [".agents/skills", "user-agents"],
];

/** Short origin label for one scanned root. */
function originOf(root) {
  const normalised = String(root === null || root === undefined ? "" : root).replace(/\\/g, "/").toLowerCase();
  for (const [fragment, label] of ORIGIN_SIGNATURES) {
    if (normalised.includes(fragment)) return label;
  }
  return "bundled";
}

/**
 * Every directory worth scanning, most specific first. Duplicates are dropped so
 * a symlinked root is not read twice, and roots that do not exist are left for
 * the caller to skip — a missing skills folder is normal.
 */
function candidateRoots() {
  const home = homedir();
  const dshHome = process.env.DSH_HOME ? process.env.DSH_HOME : join(home, ".dsh");
  const roots = [];
  const keep = (directory) => {
    const usable = typeof directory === "string" && directory !== "";
    if (usable && roots.includes(directory) === false) roots.push(directory);
  };

  keep(join(dshHome, "skills"));
  keep(join(home, ".agents", "skills"));
  keep(join(home, ".codebuddy", "skills"));
  keep(join(home, ".workbuddy", "skills"));
  keep(join(home, ".claude", "skills"));
  keep(join(dshHome, "..", "harness", "skills"));

  // Desktop builds ship Office skills next to the runtime, not under ~/.dsh.
  const officeBases = [
    process.env.DSH_DESKTOP_OFFICE_RESOURCES,
    join(dshHome, "..", "office-runtime"),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "dsh-desktop", "resources", "office-runtime") : "",
  ];
  for (const base of officeBases) {
    if (typeof base !== "string" || base === "") continue;
    const officeSkills = join(base, "office-skills");
    if (existsSync(officeSkills)) {
      keep(join(base, "business-skills"));
      keep(officeSkills);
    }
  }

  return roots;
}

//#endregion

//#region building the index

/**
 * Ask the skill service first, then the disk. The service knows about skills a
 * filesystem walk cannot reach (plugin-provided, remote); the disk knows the
 * text needed to write a real Chinese note. Both are merged by skill name, with
 * the disk copy filling any gap the service left.
 */
async function collectSkills(ctx) {
  const byName = new Map();

  try {
    const listed = await ctx.skills.list({});
    const summaries = Array.isArray(listed) ? listed : Array.isArray(listed?.candidates) ? listed.candidates : [];
    for (const summary of summaries) {
      if (summary === null || typeof summary !== "object") continue;
      if (typeof summary.name !== "string" || summary.name === "") continue;

      const file = typeof summary.path === "string" ? summary.path : "";
      const directory = file === "" ? "" : file.replace(/[\\/]SKILL\.md$/i, "");
      const fromDisk = directory === "" ? null : describeSkill(directory, summary.name, typeof summary.source === "string" ? summary.source : "registry");

      if (fromDisk !== null) {
        if (fromDisk.description === "" && typeof summary.description === "string") fromDisk.description = summary.description;
        if (summary.invocation !== undefined) fromDisk.modelInvocable = summary.invocation.modelInvocable !== false;
        byName.set(summary.name, fromDisk);
        continue;
      }

      byName.set(summary.name, {
        name: summary.name,
        description: typeof summary.description === "string" ? summary.description : "",
        hint: "",
        zh: "",
        zhSource: "",
        whenToUse: "",
        source: typeof summary.source === "string" ? summary.source : "registry",
        path: file,
        modelInvocable: summary.invocation === undefined ? true : summary.invocation.modelInvocable !== false,
        mtime: 0,
      });
    }
  } catch (error) {
    // A registry failure must not empty the panel; the walk below still runs.
    console.warn("[skill-pilot] skills.list() unavailable:", error && error.message ? error.message : error);
  }

  for (const root of candidateRoots()) {
    let dirents;
    try {
      dirents = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const origin = originOf(root);
    for (const dirent of dirents) {
      if (dirent.isDirectory() === false) continue;
      const scanned = describeSkill(join(root, dirent.name), dirent.name, origin);
      if (scanned === null) continue;

      const known = byName.get(scanned.name);
      if (known === undefined) {
        byName.set(scanned.name, scanned);
        continue;
      }
      if (known.zh === "" && scanned.zh !== "") {
        known.zh = scanned.zh;
        known.zhSource = scanned.zhSource;
      }
      if (known.hint === "" && scanned.hint !== "") known.hint = scanned.hint;
      if (known.path === "" && scanned.path !== "") known.path = scanned.path;
      if (known.description === "" && scanned.description !== "") known.description = scanned.description;
      if (known.source === "registry") known.source = scanned.source;
      if (known.mtime === 0) known.mtime = scanned.mtime;
    }
  }

  // Registry-only entries still need a category and, failing that, some note.
  for (const entry of byName.values()) {
    if (entry.hint === "") entry.hint = categoryNoun(entry.name, entry.description);
    if (entry.zh !== "") continue;
    const fromDescription = leadChineseClause(entry.description, NOTE_LIMIT);
    if (fromDescription !== "") {
      entry.zh = fromDescription;
      entry.zhSource = "description";
    } else if (entry.description !== "") {
      entry.zh = shorten(String(entry.description), NOTE_LIMIT);
      entry.zhSource = "english";
    } else {
      entry.zhSource = "none";
    }
  }

  return [...byName.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}

/** Build the payload, reusing the memoised copy unless `force` is set. */
async function buildIndex(ctx, memo, force) {
  const now = Date.now();
  if (force === false && memo.payload !== null && now - memo.builtAt < WARM_MS) return memo.payload;
  const entries = await collectSkills(ctx);
  const payload = { stamp: STAMP, total: entries.length, builtAt: now, entries };
  memo.payload = payload;
  memo.builtAt = now;
  return payload;
}

/** Emit one JSON body without buffering more than needed. */
function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/**
 * Mount both endpoints. Each is wrapped in its own effect so disposing the
 * plugin removes exactly the route it added.
 *
 * @param ctx - host context carrying `webServer` and `skills`.
 */
export function apply(ctx) {
  const memo = { payload: null, builtAt: 0 };

  const mount = (path, force, label) => {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: "exact",
          path,
          handler: async (_request, res) => {
            try {
              reply(res, 200, await buildIndex(ctx, memo, force));
            } catch (error) {
              reply(res, 500, { error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      "skill-pilot: " + label,
    );
  };

  mount(ENDPOINT.index, false, "index endpoint");
  mount(ENDPOINT.rebuild, true, "rebuild endpoint");
}

//#endregion
