# AI-teacher

面向中国学生的 AI 学习框架，目前聚焦**七年级上册数学入门**。可以在线练习、拍照问一道题、导入已答试卷/习题册，并查看知识点与细分题型的掌握证据。

当前是可运行的**本地单学生原型**，尚未制作安卓 APK。代码保存在本地，没有推送 GitHub。

## 运行

需要 Python 3.11+ 与 [uv](https://docs.astral.sh/uv/)。PDF 导入另需 Poppler 的 `pdftoppm`（本机已提供）。

```bash
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8010
```

- 学习页面：http://127.0.0.1:8010
- 接口文档：http://127.0.0.1:8010/docs
- 后续安卓客户端可复用的接口描述：http://127.0.0.1:8010/openapi.json

不配置 Key 也能在线练习、规则提示、判分和更新画像；识图与拍照题讨论需要支持图片输入的 API。

## DeepSeek 配置

首次将 `.env.example` 复制为 `.env`，填写服务端密钥；已有配置时直接编辑。修改后重启服务。

```dotenv
DEEPSEEK_API_KEY=在这里填写自己的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_VISION_MODEL=deepseek-flash
DATABASE_PATH=data/ai-teacher.sqlite3
AI_TIMEOUT_SECONDS=45
VISION_TIMEOUT_SECONDS=90
```

密钥仅由后端读取，不下发前端；`.env`、数据库、导入页面和备份均被 Git 忽略。当前图片请求使用 [DeepSeek 官方图片输入格式](https://api-docs.deepseek.com/zh-cn/guides/vision/)。

```bash
# 以下脚本调用真实 API，产生少量用量；不写入实际学生记录。
uv run python scripts/check_deepseek.py
uv run python scripts/check_vision.py
```

在线辅导收到当前题目、学习目标、相应知识点/题型摘要与最近对话；提交前不发送题库标准答案。失败时显示规则提示降级。识图在预览后点击“发送至 AI”才会上传归一化图片与课程/题型目录；失败显示原因并允许重试。

## 已有内容

| 功能 | 当前实现 |
| --- | --- |
| 课程范围 | 4 个单元、12 个知识点，包含目标、前置知识与常见误区 |
| 原创题库 | 新数据库初始 96 道题：72 道基础/进阶题、24 道挑战题；独立数学规则校验 |
| 题型画像 | 26 个预置细分题型；AI 可复用或新建类型，自动建立尚未诊断的状态 |
| 学生状态 | 知识点和题型分别记录证据、正确情况、掌握估计；保留独立/辅助作答差异 |
| 分层练习 | 基础、进阶、挑战；自动模式可按 15% 概率穿插挑战题，可关闭 |
| 拍照与试卷 | 图片/PDF 原页预览、识别题目及已答内容、编辑核对、薄弱模块与题型报告、逐题问答 |
| 自动更新 | 事务记录作答、补足未做模板题、登记 AI 新题型、保留审计事件 |
| 前端与安卓基础 | 中文手机适配界面、记录导出、REST API；后续安卓客户端可复用后端 |

起步单元为有理数、整式的加减、一元一次方程、几何图形初步，**不是某版教材的完整章节覆盖**。[课程范围](docs/curriculum.md)解释了当前边界。注册表预留学科、年级和学期；高中数学、物理内容与专用判分仍待扩展。

## 导入已答材料

1. 打开“拍照与试卷”，默认选择已作答材料；可选图片或 PDF，也可在支持的手机浏览器调起摄像头。
2. 每次最多 8 页、8 个文件，单文件 20MB、合计 40MB；PDF 可指定页码范围。上传后先预览，再主动发送 AI 识别。
3. 对照原页逐题核对题干、图形说明、学生答案、参考答案、知识点和题型；看不清或不确定的题选“无法判断”。
4. 确认后生成报告。只有明确选择计入档案的已核对对错题会更新状态；未答、无法判断和空白材料不计错。
5. 可针对一题讨论，也可从薄弱模块进入练习；删除材料同时撤销其掌握证据。

导入证据权重为在线独立练习的一半；核对前求助后答对进一步降低权重。同题跨导入按规范化题干和图形说明去重，无法识别所有改写或不同照片造成的差异。导入题保留在材料中，尚不会自动成为正式随机题库。

## 评价与题库边界

- 在线模板题使用精确数值判分，`1/2` 与 `0.5` 等价，不执行用户表达式。图片答案与过程分析是 AI 建议，由用户核对；不是经过验证的自动阅卷系统。
- AI 新建类型带来源和待审标记；相同规范化名称会复用，目前没有语义同义词合并。可在核对时改选已有题型。
- 画像采用带先验的成功/失败证据估计，不等于考试成绩；少于 3 次有效作答标记“证据不足”。题型会更细，但证据少时不会宣称已掌握。
- 题库仅自动补充经程序校验的原创模板变式；自由生成题和导入材料不会直接发布进题库。挑战题难度为模板标注，尚无学生群体校准，仍需教师审核。
- AI 新类型能建立画像；只有已有模板的类型可直接进入专项刷题。新类型的配套练习需后续补题或审核来源题。
- 公开题库候选、许可与接入计划见 [题库来源](docs/question-sources.md)。目前没有批量导入外部题集。
- 当前仅有匿名本地学生 `demo`，没有多账号、学生隔离或家长端；正式多人部署需先扩展这些能力。

## 数据与维护

SQLite 位于 `data/ai-teacher.sqlite3`，图片位于 `data/imports/`。启动执行版本迁移与同步，保留历史作答；每个知识点补足至少 6 道未做基础/进阶题与 2 道未做挑战题。

```bash
uv run python -m app.manage stats
uv run python -m app.manage sync
uv run python -m app.manage backup
```

备份使用 SQLite 在线备份 API 写入 `data/backups/时间戳.sqlite3`；存在导入图片时，同时复制到同名 `.assets` 目录。请在没有上传/删除材料时备份，恢复时关闭服务，将数据库放回配置路径，并把 `.assets` 内容恢复到旁边的 `imports/`。浏览器 JSON 导出包含答题、画像及已确认材料，不包含图片或密钥，不能代替完整备份。

## 验证与结构

```bash
uv run pytest -q
node --check web/app.js
node --check web/materials.js
uv run python scripts/browser_smoke.py
uv run python scripts/browser_materials.py
```

测试使用临时数据库与模拟 AI，不修改实际学生记录，也不调用付费接口。覆盖 5,400 套参数题校验、迁移、重复计分、导入事务、图片/PDF 校验、题型新建与手机操作。[验证记录与截图](docs/validation.md)。

```text
app/
  main.py           HTTP API 与页面入口
  config.py         服务端配置
  curriculum.py     学习目标与知识点依赖
  questions.py      基础模板、数值判分与校验
  challenges.py     挑战模板与独立校验
  question_types.py 题型注册与画像
  materials.py      图片/PDF、识别、核对、报告与拍照题讨论
  db.py             数据库、迁移、补题与审计
  learning.py       掌握证据、推荐与作答事务
  tutor.py          DeepSeek 与规则辅导
  manage.py         同步、统计与备份
web/                无需构建的中文手机适配界面
tests/              自动化测试
scripts/            浏览器及真实 API 检查
docs/               课程边界、架构、来源与验证
```

后续优先补齐具体教材的有理数单元，审核外部题并支持选择题/分步评分；再扩展多学生与安卓客户端。[架构与安卓路线](docs/architecture.md)。

课程依据：[教育部课程标准发布页](https://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html)。课标规定学段目标，当前学期划分由项目整理。
