# Nova · 协作项目平台

## Go + React + MySQL MVP

新增的 MVP 位于 `backend/` 与 `frontend/`，覆盖账号注册登录、服务端 Session、基础 RBAC、需求和 Bug 的增删改查、状态流转与列表筛选。Go 服务将 React 构建产物嵌入单一二进制。原有 `server/`、`web/` 是旧版 Node.js 演示原型，保留作参考；下面原型说明不适用于新 MVP。

**推荐启动方式：**准备 Docker Compose，设置 `MYSQL_ROOT_PASSWORD`、`MYSQL_PASSWORD` 与至少 12 位的 `ADMIN_PASSWORD`，运行 `docker compose up --build`，访问 `http://localhost:8080`。默认仅监听服务器本机；需要从其他设备访问时设置 `APP_BIND` 为指定服务器网卡地址，并可用 `APP_PORT` 调整端口。首次启动会自动创建管理员账号（默认用户名 `admin`），不会覆盖已有管理员。MySQL 数据保存在 `mysql_data` 卷，服务重启不会清除。对外启用 HTTPS 时设置 `COOKIE_SECURE=true`。

本机开发可先启动 MySQL 8.4，然后设置 `MYSQL_DSN`（需包含 `parseTime=true`），在 `frontend/` 运行 `npm ci && npm run build`，在 `backend/` 运行 `go run .`。前端热更新可另开终端运行 `cd frontend && npm run dev`，Vite 将 `/api` 代理到 8080。构建顺序是前端先、Go 后；Go 的 `embed` 在编译时将 `backend/static` 打入二进制。

核心 API：`POST /api/register`、`POST /api/login`、`POST /api/logout`、`GET /api/me`；`/api/requirements` 和 `/api/bugs` 支持 GET 列表、POST 新建及 `/:id` 的 GET/PUT/DELETE；`GET/POST /api/users`、`PUT /api/users/:id`、`GET/POST /api/roles`、`PUT /api/roles/:id` 用于管理。列表支持 `status`、`assigneeId` 及 `priority`（需求）或 `severity`（Bug）参数。状态枚举分别为 `pending/in_progress/done/rejected/closed` 和 `new/assigned/fixing/verified/closed`；严重程度枚举为 `fatal/critical/normal/minor`。非法状态跳转返回 409。除注册和登录外，所有 API 必须登录；管理写入须有相应 RBAC 权限。

新 MVP 测试：`cd backend && go test ./...`、`cd frontend && npm run build`。设置独立测试库的 `MYSQL_TEST_DSN` 后，Go 测试还会执行真实 MySQL 的账号、权限、工单持久化和登出失效集成测试。浏览器验收需在可运行 MySQL 8.4 的环境执行。

## 旧版 Node.js 演示原型

一个可直接运行的「类飞书项目」原型，覆盖需求管理、缺陷管理与权限管理三条主线。

仓库：https://github.com/mer163/nova-project

零依赖：只用 Node.js 内置模块（`node:http`、`node:crypto`、`node:fs`），数据落在本地 JSON 文件，启动即可用。

## 快速开始

```bash
node server/index.js          # http://localhost:3000
PORT=8080 node server/index.js
NOVA_SEED_PASSWORD=your-pass node server/index.js
npm test                      # 接口与权限测试
```

首次启动会自动写入演示数据到 `data/db.json`（该文件已忽略，不会进仓库）。删除该文件即可重新初始化。

| 账号 | 角色 | 能做什么 |
| --- | --- | --- |
| `admin@nova.dev` | 超级管理员 | 全部权限，含角色与工作流配置 |
| `pm@nova.dev` | 项目负责人 | 建空间、管成员、推进全流程 |
| `dev@nova.dev` | 研发 | 处理需求/缺陷，提交测试 |
| `qa@nova.dev` | 测试 | 验证缺陷、推进状态 |
| `guest@nova.dev` | 访客 | 只读已授权空间，无编辑入口 |

演示密码为 `nova-demo-2024`，可用 `NOVA_SEED_PASSWORD` 覆盖；登录页点击演示账号会自动填充。

## 功能范围

**需求 / 缺陷 / 任务**
- 三种类型共用编号体系（`REQ-` / `BUG-` / `TASK-`），列表与看板两种视图
- 列表支持类型、空间、状态、关键字、只看我的组合筛选
- 看板按工作流状态分列，拖拽卡片即触发状态流转，非法流转会被服务端拒绝
- 详情抽屉：标题/描述就地编辑、状态、负责人、优先级、截止日期、评论、操作历史
- 进度通过工作流驱动，每次流转都会写入操作记录与审计日志

**权限**
- 两层模型：全局角色（平台能力）× 空间成员角色（负责人 / 可编辑 / 只读）
- 权限矩阵可配置，内置管理员、项目负责人、研发、测试、访客五个角色
- 空间成员可单独授予只读/可编辑，负责人可增删成员
- 所有校验在服务端执行，前端只做入口隐藏
- 非法操作返回明确错误，例如「当前角色「访客」没有 issue:create 权限」

**工作流**
- 需求流程：待评估 → 已规划 → 开发中 → 待测试 → 已完成
- 缺陷流程：待处理 → 修复中 → 待验证 → 已关闭
- 状态与流转规则可在「成员与权限 → 工作流」中维护
- 删除仍被工单使用的状态会被拒绝

**迭代**
- 迭代含目标、起止日期与状态（未开始/进行中/已结束），自动统计完成进度与估算点数
- 工单可挂到迭代，列表可按迭代筛选，删除迭代会解绑工单
- 迭代看板给出类型分布、成员负载与估算合计

**通知与协作**
- 关注工单后，状态变更、被指派和新评论会进入通知中心
- 未读数显示在侧栏角标，支持单条已读与全部已读
- 附件上传下载，限制 5MB，拦截可执行与脚本类扩展名

**效率**
- 列表支持多选批量修改负责人、优先级与迭代，越权项自动跳过并提示
- 按当前筛选条件导出 CSV（带 BOM，Excel 直接可读）

**其他**
- 审计日志记录登录、工单增删改、流转、成员与角色变更
- 工作台汇总待办、类型分布、成员负载、进行中迭代与最近更新

## 目录结构

```
server/
  index.js            启动入口
  app.js              路由表与请求分发（可测试）
  lib/db.js           JSON 持久化与审计写入
  lib/auth.js         scrypt 密码、会话、权限与空间角色校验
  lib/workflow.js     内置工作流定义与流转规则
  lib/notify.js       通知投递
  lib/seed.js         演示数据
  routes/             auth / issues / spaces / admin / iterations / notifications / files
web/
  index.html
  css/app.css         设计系统（颜色、间距、组件）
  js/app.js           hash 路由与主框架
  js/api.js           请求封装
  js/ui.js            通用组件
  js/views/           登录、工作台、工单、迭代、通知、空间、成员与权限、设置
tests/
  api.test.js         权限、工作流与接口行为测试
  iterations.test.js  迭代、通知、批量、导出与附件测试
docs/
  permissions.md      权限模型说明
  product-overview.md 产品范围与信息架构
  delivery.md         交付说明与验证记录
```

## 已知边界

单机 JSON 存储、会话写在同一个 JSON 文件里，适合演示与小团队试用；生产化需要替换为关系型数据库、对象存储、SSO 与细粒度字段权限。Webhook、外部消息推送与跨项目报表尚未实现。
