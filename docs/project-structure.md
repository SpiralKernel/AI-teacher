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
│   ├── index.html            页面壳、导航、脚本加载顺序
│   ├── js/                   页面逻辑
│   │   ├── app.js            全局状态、导航、原数学地图及练习
│   │   ├── settings.js       集中设置、当前范围显示、偏好同步
│   │   ├── bank.js           全科题库、目标报告与主观题交互
│   │   └── materials.js      已答试卷导入、识别、核对与讨论
│   ├── css/style.css         共用样式及手机布局
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
    └── sources/              公开题集及课程资料缓存
```

`app/data/`是随代码维护的来源与标注；根目录`data/`是运行数据。两者职责不同。数据库和图片位置保持原样，以便继续读取已有学习记录。

## 后端改动查哪里

| 要改的内容 | 主要文件 | 关联验证 |
| --- | --- | --- |
| HTTP入口、原数学练习/试卷接口 | `app/main.py` | `tests/test_learning.py`、`tests/test_materials.py` |
| 全科题库与评阅接口 | `app/bank_api.py` | `tests/test_bank.py` |
| 课程目录、进度、设置接口 | `app/course_api.py` | `tests/test_courses.py` |
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

## 设置与页面如何连起来

主导航“设置”、顶部当前科目/阶段按钮、首页“切换科目 / 阶段”进入同一页面。草稿在点击保存后写入`/api/v1/courses/preferences`。

`student_preferences`保存当前科目和练习偏好，`course_settings`按科目保存册次与单元。启动页面读取已保存设置；题库里的快捷切换也调用相同保存逻辑，顶部、首页与设置页保持一致。前端脚本由`index.html`以`defer`顺序加载，共用`app.js`的状态和请求工具；各模块在用户操作时调用，避免在脚本顶层发起请求。

原模板地图与整卷导入仍服务七上数学。设置为其它范围时，首页和“开始练习”提供当前题库入口；整卷导入页显示自己的适用范围。全科逐题拍照评阅继续支持各科。

## 维护命令

```bash
cd /home/sink/AI-teacher
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8010
```

| 工具 | 用途 |
| --- | --- |
| `scripts/fetch_sources.py` | 下载题库来源缓存 |
| `scripts/fetch_textbooks.py` | 整理智慧教育平台公开人教初中教材目录；不获取登录后的正文 |
| `python -m app.manage import-bank --stage junior` | 将缓存题库去重入库，增量映射目标 |
| `scripts/export_curriculum.py` | 从运行时目录生成`docs/junior-curriculum.md`；`--check`检查一致性 |
| `scripts/browser_smoke.py` | 原数学练习桌面/手机流程 |
| `scripts/browser_materials.py` | 模拟AI验证试卷导入流程 |
| `scripts/browser_bank.py` | 模拟AI验证全科题库、设置保存和手机布局 |
| `scripts/check_deepseek.py`、`check_vision.py`、`check_written.py` | 真实API验证，产生模型用量；临时数据库 |
| `python -m app.manage backup` | 备份数据库及上传图片 |

前端语法检查路径为`web/js/*.js`。浏览器脚本的截图统一写入`docs/previews/`。调整目录时同时修改`index.html`、脚本输出路径、文档链接和静态资源测试；不移动正在使用的数据库或图片目录。

课程依据见[阶段要求](junior-curriculum.md)，业务流程见[架构](architecture.md)，验证和截图见[验证记录](validation.md)。
