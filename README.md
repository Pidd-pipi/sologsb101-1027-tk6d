# 精酿糖化配方与发酵比重台（gbbrewhouse）

面向精酿车间酿酒师与糖化班组的本地化工艺台账：按配方把麦芽投料糖化，编排升温步与洗糟，记录煮沸投花时间表，逐日测量发酵比重与双乙酰还原情况，算出收得率与酒精度，最后登记罐装批次并归档实绩。

核心动作：**建配方与风格 → 维护麦芽酒花辅料库 → 排糖化升温步 → 录煮沸投加 → 跟踪发酵比重 → 罐装归档与结构版本导出**。

纯前端单页应用（Angular 18 + TypeScript + Angular Material + RxJS + NgRx + Angular Router + Dexie），**无后端、无数据库服务、无 API 服务**，全部数据保存在浏览器本地（IndexedDB），刷新或重启浏览器后仍然存在。

---

## 一、Docker 一键启动（推荐）

```bash
# 1. 首次启动先复制环境变量模板
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build
```

启动完成后访问：**http://localhost:22827**

常用命令：

```bash
docker compose ps                 # 查看服务状态（healthy 表示就绪）
docker compose logs -f frontend   # 查看 nginx 日志
docker compose down               # 停止并移除容器
docker compose up -d --build      # 代码改动后重新构建
```

> 端口可在 `.env` 中通过 `FRONTEND_PORT` 修改；容器名固定为 `${COMPOSE_PROJECT_NAME:-gbbrewhouse}-frontend`。
> 容器无状态：不连接数据库、不挂载命名卷，数据全部在浏览器本地，迁移设备请使用应用内「导出整库 JSON / 导入备份」。
> Angular 的构建产物在 `dist/gbbrewhouse/browser`（application builder 的默认结构），Dockerfile 已按此路径拷贝。

---

## 二、技术栈

| 分类 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Angular 18（standalone 组件 + 内置控制流 `@if` / `@for`） | 全部页面为独立组件并按路由懒加载 |
| 语言 | TypeScript（`strict: true`，`strictTemplates: true`） | `npm run build` = `ng build`，含 AOT 模板类型检查 |
| UI 组件库 | Angular Material 18 + Angular CDK（`DragDropModule`） | 卡片、表单、下拉、表格、拖拽调序、SnackBar |
| 响应式 | RxJS 7（`combineLatest` / `forkJoin` / `switchMap`） | 派生比重序列、表观发酵度与收得率 |
| 状态管理 | NgRx 18（Store + Effects + DevTools） | `recipe` / `ferment` / `ingredients` / `mash` / `boil` / `packaging` 六个 feature |
| 路由 | Angular Router（`app.routes.ts`，history 模式） | nginx 侧配合 `try_files` 做 SPA fallback |
| 本地存储 | Dexie 4（IndexedDB 封装） | 库名 `gbbrewhouse-db`，含结构版本号与 upgrade 迁移 |
| 容器化 | Docker 多阶段构建：`node:20-alpine` → `nginx:alpine` | 构建阶段执行生产构建，运行阶段仅托管静态产物 |

---

## 三、本地开发方式

```bash
cd frontend
npm install
npm start          # ng serve --port 22827 → http://localhost:22827
npm run build      # ng build，产物在 frontend/dist/gbbrewhouse/browser
```

---

## 四、页面与路由

| 路由 | 模块 | 消费模型 | 主要交互 |
| --- | --- | --- | --- |
| `/recipes` | 配方与风格台账 | Recipe、RecipeMalt、Malt、Packaging | 新建/编辑/删除配方（级联删除确认）、按风格筛选、实时回算实绩 OG/FG、ABV、发酵度；**色度偏差读缓存快照，主档色度改动后先标「待重算」**、筛选同步 URL query |
| `/ingredients` | 麦芽与酒花辅料库 | Malt、Hop、RecipeMalt、BoilAdd、Recipe | 主档全局维护（色度、α 酸唯一出处）、按色度/α 酸/产地筛选；维护当前配方麦芽投料配比；**改色度/α 酸立即把引用方快照作废标「待重算」，删除被引用的主档会被拦住** |
| `/mash` | 糖化升温步编排与洗糟 | MashStep、Recipe | **Angular CDK 拖拽调序**（含上下移按钮）、逐条签署完成、进度与总水量统计 |
| `/boil` | 煮沸投花时间表 | BoilAdd、Hop、Recipe | 按投加时点倒计时排序、**高亮下一投加点**、**投花按 id 认酒花主档（不再照名字认）**、认不到主档的旧投加列入**待指认**、α 酸改动后 IBU 标「待重算」 |
| `/ferment` | 发酵比重与双乙酰还原 | Ferment、Recipe | 批次切换、逐日录入比重/温度/双乙酰、**趋势条（超温标红）**、双乙酰低于阈值提示还原完成、停滞判定 |
| `/packaging` | 罐装批次登记与结构版本导出 | Packaging 及全部模型 | 由发酵读数自动带出 OG/FG 与 ABV、配方实绩档案导出、本地库版本查看与整库 JSON 导入导出 |

---

## 五、目录结构

```
sologsb101-1027/
├── README.md
├── docker-compose.yml
├── .env / .env.example
├── .gitignore
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf              # try_files SPA fallback + gzip
    ├── .dockerignore
    ├── angular.json / tsconfig.json / tsconfig.app.json / package.json
    ├── public/favicon.svg
    └── src/
        ├── index.html  main.ts  styles.css
        └── app/
            ├── app.component.ts  app.config.ts  app.routes.ts
            ├── core/models/         recipe malt recipe-malt hop mash-step boil-add ferment packaging（+ filter）
            ├── core/services/       recipe.service.ts gravity-trend.service.ts idb-table.service.ts
            ├── core/state/          recipe/{actions,reducer,selectors,effects}
            │                        ferment/{actions,reducer,selectors,effects}
            │                        ingredients/ mash/ boil/ packaging/（各 actions + reducer + selectors）
            ├── core/utils/          brew.ts db.ts export.ts seed.ts uuid.ts
            ├── shared/components/   style-tag/ filter-bar/ stat-badge/ empty-panel/
            └── features/            recipes/ ingredients/ mash/ boil/ ferment/ packaging/
```

---

## 六、数据存储说明

- **IndexedDB 库名**：`gbbrewhouse-db`（Dexie 封装），结构版本号 `version(2)`，带 `upgrade()` 迁移逻辑。
- **分表存储**：`recipes` 配方、`malts` 麦芽主档、`hops` 酒花主档、`recipeMalts` 配方麦芽投料（按 `maltId` 引用主档）、`mashSteps` 糖化步、`boilAdds` 煮沸投加（按 `hopId` 引用主档）、`ferments` 发酵读数、`packagings` 罐装批次，共 8 张表；每行带 `revision` / `createdAt` / `updatedAt`。
- **唯一出处 + 快照作废重算**：麦芽 / 酒花主档是色度与 α 酸的唯一出处。配方保存加权色度快照 `ebcSnapshot`、投花保存 α 酸 / IBU 快照；主档相关值一改动，引用方快照立即置 `stale` 并在页面先标出「待重算」，旧值不作数，由用户确认后再重算。
- **投花认主档**：煮沸投花按 `hopId` 认酒花主档，不再照 `material` 名字认；对不上主档的投加列入「待指认」等人处理，也可标为非酒花辅料（澄清剂等，不计 IBU）。
- **删除拦截**：删除麦芽 / 酒花主档前校验引用，仍被配方投料或投花引用时拒绝删除。
- **首屏自动播种**：`core/utils/db.ts` 的 `initDatabase()` 在 `recipes` 表为空时调用 `seedDatabase()`，灌入互相引用的三层演示数据（配方 → 主档/麦芽投料/糖化步/煮沸投花 → 发酵读数 → 罐装批次），保证 6 个页面首次打开都有内容；播种幂等。
- **v1 → v2 升级**：旧的挂配方麦芽 / 酒花行按名字去重收敛为全局主档，每行旧麦芽生成一条 `recipeMalts` 引用；旧的照名字写的投花在升级时按名字认到酒花主档，认不出的（且非澄清辅料）留空进入「待指认」；导入旧版整库 JSON 备份时执行同一套归一化规则。
- **状态流**：页面只 `dispatch` NgRx actions 并 `select` 状态流，所有读写最终由 `core/services/recipe.service.ts` → `IdbTableService` → Dexie 落库，跨页状态不留在组件字段。
- **无后端**：没有 API 服务、没有数据库容器；容器本身无状态，不挂载任何卷。
- **级联规则**：删除配方会级联删除其麦芽投料、糖化步、煮沸投加、发酵读数与罐装批次（麦芽 / 酒花主档全局共享，保留不删）。
