# 本地目录与维护入口

项目根目录：`/home/sink/AI-teacher`。后端、前端、文档、测试及运行数据都在这个目录中；运行命令也从这里执行。

## 目录分工

```text
AI-teacher/
├── README.md                 运行方法、功能与边界
├── pyproject.toml            Python依赖与测试配置
├── uv.lock                   依赖锁定版本
├── .env.example              配置模板（可提交）
├── .env                      本机API密钥与配置（忽略）
├── app/                      Python后端，按业务模块划分
│   └── data/                 自编/补充标注、来源指纹（可提交）
├── web/                      浏览器入口与静态资源
│   ├── index.html            当前页面壳，仅加载 student.js 与 KaTeX
│   ├── js/                   页面逻辑
│   │   ├── student.js        当前入口：登录、题库与页面壳、设置弹窗
│   │   ├── teacher.js        自由答疑、照片、即时帮助抽屉
│   │   ├── imports.js        当前习题导入、识别、核对
│   │   ├── report.js         自动学情分析与PDF入口
│   │   ├── app.js            全局状态、导航、原数学地图及练习
│   │   ├── math.js           七上题型地图、覆盖、诊断与后续练习
│   │   ├── settings.js       集中设置、当前范围显示、偏好同步
│   │   ├── bank.js           全科题库、目标报告与主观题交互
│   │   └── materials.js      已答试卷导入、识别、核对与讨论
│   ├── css/student.css       当前两模式界面样式与手机布局
│   ├── css/style.css         历史多面板界面样式（当前不加载）
│   ├── assets/icon.svg       应用图标
│   └── vendor/katex/         本地公式渲染依赖及字体
├── tests/                    后端测试；使用临时数据库
├── scripts/                  手动维护和验证工具
├── docs/                     课程、架构、来源及维护文档
│   └── previews/             页面截图与原创识图示例
└── data/                     本机运行数据（内容忽略）
    ├── ai-teacher.sqlite3    学生记录与导入题库
    ├── backups/              数据库和图片备份
    ├── imports/              已答试卷原页与归一化图片
    ├── bank_answers/         全科主观题解答照片
    ├── teacher_images/       私有答疑照片
    └── sources/              公开题集及课程资料缓存
```

`app/data/`是随代码维护的来源与标注；根目录`data/`是运行数据。两者职责不同。数据库和图片位置保持原样，以便继续读取已有学习记录。

## 后端改动查哪里

| 要改的内容 | 主要文件 | 关联验证 |
| --- | --- | --- |
| 学生账号、会话、请求作用域身份 | `app/auth.py`、`app/identity.py`、`app/main.py` | `tests/test_student.py` |
| 题库与可靠题型证据、复测 | `app/study.py`、`web/js/student.js`、`web/css/student.css` | `tests/test_student.py`、`scripts/browser_student.py` |
| 自由答疑与可纠正的学习线索 | `app/teacher.py`、`app/observations.py`、`web/js/teacher.js` | `tests/test_teacher_reports.py` |
| AI教学规则、引用约束与独立复核 | `app/ai_policy.py`、`app/observation_guard.py` | `tests/test_ai_guard.py`、`scripts/eval_teaching.py` |
| 家长报告、AI分析、PDF | `app/reports.py`、`app/report_pdf.py`、`web/js/report.js` | `tests/test_teacher_reports.py` |
| HTTP入口、原数学练习/试卷接口 | `app/main.py` | `tests/test_learning.py`、`tests/test_materials.py` |
| 全科题库与评阅接口 | `app/bank_api.py` | `tests/test_bank.py` |
| 课程目录、进度、设置接口 | `app/course_api.py` | `tests/test_courses.py` |
| 七上标准题型、覆盖、抽样诊断 | `app/math_catalog.py`、`app/math_learning.py`、`app/math_api.py`、`web/js/math.js` | `tests/test_math_learning.py`、`scripts/browser_math.py` |
| 当前科目、练习范围、挑战偏好 | `app/preferences.py` | `tests/test_courses.py` |
| 学段目标、册次、单元、教材核对状态 | `app/course_catalog.py` | `tests/test_courses.py`、文档导出检查 |
| 目标与题目候选映射、目标证据、AI阶段上下文 | `app/courses.py` | `tests/test_courses.py` |
| 原数学地图、目标依赖 | `app/curriculum.py` | `tests/test_learning.py` |
| 原创题与挑战题生成、精确校验 | `app/questions.py`、`app/challenges.py` | `tests/test_learning.py`、`tests/test_question_types.py` |
| 全科题库、标签、筛选、选择判分、画像 | `app/bank.py` | `tests/test_bank.py` |
| 外部题库适配与去重 | `app/datasets.py` | `tests/test_datasets.py` |
| 主观题AI评阅及辅导 | `app/bank_ai.py` | `tests/test_bank.py`、`tests/test_courses.py` |
| 原数学辅导提示词与API调用 | `app/tutor.py` | `tests/test_learning.py` |
| 细分题型注册和知识点证据 | `app/question_types.py`、`app/learning.py` | 对应同名测试文件 |
| 图片/PDF导入、识别、核对 | `app/materials.py` | `tests/test_materials.py` |
| 数据库迁移、初始化与模板补题 | `app/db.py` | 迁移与记录保留测试 |
| 服务端配置、管理命令 | `app/config.py`、`app/manage.py` | 备份、导入、同步的已有测试 |

后端模块目前在`app/`内按职责命名。新增业务应先放到对应模块；扩展到需要包目录时再按课程、题库、材料拆包，迁移时同步调整导入和测试。

## 当前学生入口

`index.html`只加载本地公式依赖、`student.js`和`student.css`。页面先读取`/auth/session`，未登录显示创建/登录界面；已登录读取`/study/home`，默认进入“AI老师”，主导航另有“题库”；顶部提供“学情报告”。右上角“学习设置”弹窗保存年级与学期到`student_scopes`，不新增导航模式。

`auth.py`管理加盐密码哈希、会话摘要及首次账号认领；`identity.py`通过ContextVar传递学生和阶段。`main.py`在请求入口校验身份，`db.connect()`把该连接的身份注册为SQLite的`current_student()`函数，业务查询和写入显式按当前学生执行。`bank.clauses()`还强制当前数学册次、来源年级学期与课程目标范围；直接给出题目ID同样受限。

`study.py`统一可靠练习证据；`teacher.py`与`observations.py`处理无需做题门槛的自由答疑和自动学习线索；`reports.py`与`report_pdf.py`生成家长报告。对话写入`teacher_messages`，不增加独立核验题量。学习线索可纠正，报告自动随证据更新。具体规则见[学生流程](student-flow.md)。

旧`app.js`、`math.js`、`settings.js`、`bank.js`与`materials.js`暂保留为历史页面实现，不由当前入口加载。全科课程、题库入库、教材归档和旧诊断后端继续供维护和回归测试使用；其旧浏览器脚本不能当作新学生页面的验收。

## 维护命令

```bash
cd /home/sink/AI-teacher
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8010
```

| 工具 | 用途 |
| --- | --- |
| `scripts/fetch_sources.py` | 下载题库来源缓存 |
| `scripts/export_math.py` | 导出标准题型地图及本机只读覆盖报告 |
| `scripts/eval_teaching.py` | 合成教学样例，默认模拟，`--live`调用配置模型；临时数据库 |
| `scripts/browser_student.py` | 当前AI/题库、导入、报告界面的临时数据库/模拟AI浏览器验收 |
| `scripts/browser_math.py` | 历史七上诊断页面验收，当前入口不加载该页面 |
| `scripts/import_textbook.py` | 归档本地教材及逐页文字；目录核对清单为`app/data/textbook_reviews.json`，操作说明见[本地教材](local-textbooks.md) |
| `scripts/fetch_textbooks.py` | 整理智慧教育平台公开人教初中教材目录；不获取登录后的正文 |
| `python -m app.manage import-bank --stage junior` | 将缓存题库去重入库，增量映射目标 |
| `scripts/export_curriculum.py` | 从运行时目录生成`docs/junior-curriculum.md`；`--check`检查一致性 |
| `scripts/browser_smoke.py` | 历史数学页面脚本，当前以 browser_student.py 为准 |
| `scripts/browser_materials.py` | 历史试卷页面验收，后端回归测试仍保留 |
| `scripts/browser_bank.py` | 历史全科页面验收，当前以 browser_student.py 为准 |
| `scripts/check_deepseek.py`、`check_vision.py`、`check_written.py` | 真实API验证，产生模型用量；临时数据库 |
| `python -m app.manage backup` | 备份数据库及上传图片 |

前端语法检查路径为`web/js/*.js`。浏览器脚本的截图统一写入`docs/previews/`。调整目录时同时修改`index.html`、脚本输出路径、文档链接和静态资源测试；不移动正在使用的数据库或图片目录。

课程依据见[阶段要求](junior-curriculum.md)，业务流程见[架构](architecture.md)，验证和截图见[验证记录](validation.md)。
