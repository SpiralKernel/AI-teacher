# AI-teacher

面向中国初中学生的本地学习项目。当前学生界面从**数学**开始：默认进入**AI老师**，随时问知识、拍照问题、导入习题；**题库**积累独立作答证据。顶部提供**学情报告**与**学习设置**。

支持本机多学生账号、年级学期设置、文字与拍照作答。已有全科课程、题库、教材归档和导入能力保留在后端及维护工具中；当前是本地 Web 原型，尚未制作安卓 APK。项目仓库：[SpiralKernel/AI-teacher](https://github.com/SpiralKernel/AI-teacher)。

## 运行与首次使用

需要 Python 3.11+ 与 uv，从项目根目录执行：

```bash
git clone https://github.com/SpiralKernel/AI-teacher.git
cd AI-teacher
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8010
```

打开 [学习页面](http://127.0.0.1:8010)。首次创建用户名、密码并选择年级和学期。**本机第一个账号继承旧 demo 学生的答题记录**；后续账号从空白状态开始，不共享题型状态、照片或讨论。密码至少 8 位，使用 scrypt 加盐哈希；会话凭证通过 HttpOnly、SameSite Cookie 保存。

进入后用右上角“学习设置”切换年级、学期。学生题目在服务端按身份和当前阶段筛选，直接调用接口也不能通过另一个册次或题目 ID 越过当前范围。切换阶段保留历史记录，切回可继续查看。

## 学习入口

- **题库**：选择当前学期的章节，开始或继续练习；可关闭随机挑战题。七上短答优先使用独立数学规则核验的原创题，精确比对数值答案。选择“文字 / 拍照题”提交完整过程，核对 AI 转写和正误后保存记录。
- **AI老师**：零做题记录也能文字或拍照提问；每道题有“问问 AI”入口，保留草稿。AI按学生原话自动记录题型兴趣、自述困难、引导后理解等线索，新题型可自动登记；学生可标记记录不准确。
- **导入练习**：在 AI老师中导入空白习题或已答试卷，支持图片/PDF，识别后逐题核对题干、答案及正误。已核对作答形成学习线索。
- **学情报告**：自动汇总作答、提问、导入题目与章节状态，按周/月/全部生成 AI分析和家长建议；新证据自动触发更新，可导出中文PDF。教材仅用于后台提供当前阶段要求。

题型状态只有“未评估 / 证据不足 / 需要补强 / 表现稳定”，不显示掌握百分比。判断结合最近五次表现及连续正确情况，属于保守的启发式规则，尚非经过校准的能力测验。重复题、使用提示的作答、导入试卷和 AI 评阅不会凑足独立核验题量。来源题未逐题核验时只保存作答记录，不据此形成可靠诊断。对话学习线索与独立练习状态分开保存和展示，不能因一次提问就判定不会。

目前七上有 37 个标准题型，其中 26 个有规则核验题。其余 11 个继续作为待补题型显示。七下和八、九年级可练习匹配课程目标的来源题，核验不足时不会假装形成可靠评分。具体规则见 [学生流程与证据](docs/student-flow.md)。

## AI 配置

首次复制 `.env.example` 为 `.env`，已有配置直接编辑后重启。密钥只由服务端读取，不下发浏览器。

```dotenv
DEEPSEEK_API_KEY=填写自己的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_VISION_MODEL=deepseek-flash
DATABASE_PATH=data/ai-teacher.sqlite3
AI_TIMEOUT_SECONDS=45
VISION_TIMEOUT_SECONDS=90
AUTH_REQUIRED=true
```

无 Key 可登录、做核验题和更新题型状态。AI 讲解、识图与主观题评阅需要所配置模型支持相应能力；调用失败会保留原状态并允许重试。图片解读和手写转写仍需核对，不能据测试样例推断所有图形及手写过程均能可靠判断。

`AUTH_REQUIRED` 默认 `true`。旧业务单元测试显式使用 `false` 来验证历史单学生接口；日常运行保持默认，所有学生请求走身份隔离。旧地图、百分比画像和独立诊断面板不由学生入口加载。旧有门槛的补强接口保留回归兼容，新界面答疑统一使用 `/teacher`，无需先做五题。

## 目录与已有数据

| 位置 | 职责 |
| --- | --- |
| `app/auth.py`、`app/identity.py` | 账号、会话、当前学生及阶段 |
| `app/study.py` | 当前题库 API、可靠题型证据与复测 |
| `app/teacher.py`、`app/observations.py` | 自由答疑、即时求助、图片作答核对与学习线索 |
| `app/ai_policy.py`、`app/observation_guard.py` | 固定教学规则、证据前置条件与独立复核 |
| `app/reports.py`、`app/report_pdf.py` | 学情汇总、AI分析缓存、中文PDF |
| `app/bank.py`、`app/bank_ai.py` | 全科题库、来源标签、照片评阅 |
| `app/course_catalog.py`、`app/courses.py` | 阶段要求和候选题目映射 |
| `web/index.html`、`web/js/student.js`、`web/css/student.css` | 当前学生界面 |
| `tests/`、`scripts/`、`docs/` | 回归测试、维护工具、课程与项目文档 |
| `data/` | 本机数据库、上传图片、缓存与备份，不提交 Git |

当前题库保留初中 11 科、27,153 道题及 7,330 个知识点/题型标签；26,855 道具备练习所需材料。语文长阅读和全科主观题后端继续保留，学生界面暂聚焦数学。体音美不纳入。题目来源许可、缺图、答案复核与版本保留规则见 [题库来源](docs/question-sources.md)。非商用并不替代来源许可核对。

以上题库数量是开发机导入后的统计，不代表仓库附带完整题库。公开仓库仅包含代码、课程/题型元数据、测试和示例截图；API 密钥、学生账号与记录、上传材料、原始题库缓存及教材 PDF 均不提交。新安装可直接使用代码生成的数学核验题，其它来源题需自行按许可导入。

课程目录含 56 个阶段、170 个单元、186 项目标。已核对用户提供的数学七上、七下、八上、八下 PDF 目录；九下 PDF 保留不同章节安排参考，仍缺九上。其他学科仅部分册次已核对，其余明确标为课标进阶建议。候选知识标签映射不等于逐题匹配教材或完整覆盖目标。

- [目录分工与维护入口](docs/project-structure.md)
- [全科阶段要求](docs/junior-curriculum.md)
- [本地教材与核对边界](docs/local-textbooks.md)
- [数学题型地图](docs/math-type-map.md)与[核验题覆盖](docs/math-coverage.md)
- [教材获取清单](docs/textbook-catalog.md)
- [AI教学规则、限制与评测](docs/ai-policy.md)
- [验证记录](docs/validation.md)

## 维护与验证

```bash
uv run python -m app.manage backup
uv run python -m app.manage stats
uv run python -m app.manage import-bank --stage junior
uv run python scripts/export_curriculum.py --check
uv run python scripts/export_math.py --check
uv run python scripts/eval_teaching.py
uv run pytest -q
PYTHONPATH=. uv run python scripts/browser_student.py
```

浏览器验收使用本机 Chrome、临时数据库与本地模拟 AI，覆盖注册、零记录答疑、照片问题、自动学习线索、即时求助保留草稿、识图导入核对、AI报告/PDF、阶段切换、多学生和手机布局，不消耗真实 API，也不修改真实学生记录。旧 `browser_math.py` 等脚本验证的是历史页面，不再作为当前学生界面的验收入口。

当前数据库 schema9，新增自由答疑、学习线索、报告缓存及导入材料所属册次；schema8账号、会话与旧讨论保留，保留原题快照及学生作答。升级真实库前使用 SQLite 在线备份，并逐表核对原有记录。

未来安卓客户端可复用 `/api/v1/auth/*`、`/api/v1/study/*`、`/api/v1/teacher/*`、`/api/v1/reports*` 与题库提交/评阅接口；当前是本地可运行 Web 原型。接口定义位于 [OpenAPI](http://127.0.0.1:8010/openapi.json)。

当前配色：`#FFF8F5`背景、`#F5E2DA`卡片、`#E4A28F`主按钮、`#85A9AF`辅助强调、`#3B3838`文字。

具体困难与理解通过需要独立复核；单纯提问不计不会，图片作答先核对转写再分析。复核失败保留讲解、暂不更新相应状态，仍不会增加独立核验题量。
