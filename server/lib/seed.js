import { db } from './db.js';
import { hashPassword } from './auth.js';
import { DEFAULT_WORKFLOWS, initialStatus } from './workflow.js';

const ROLES = [
  {
    id: 'admin',
    name: '超级管理员',
    description: '管理成员、角色、空间与全部工单',
    permissions: ['*'],
    builtin: true,
  },
  {
    id: 'pm',
    name: '项目负责人',
    description: '创建空间与需求，推进全流程，不能管理角色',
    permissions: [
      'issue:read', 'issue:create', 'issue:update', 'issue:delete', 'issue:transition',
      'issue:comment', 'issue:assign', 'space:read', 'space:create', 'space:manage',
      'member:manage', 'audit:read',
    ],
    builtin: true,
  },
  {
    id: 'dev',
    name: '研发',
    description: '处理需求与缺陷，提交测试',
    permissions: [
      'issue:read', 'issue:create', 'issue:update', 'issue:transition',
      'issue:comment', 'issue:assign', 'space:read',
    ],
    builtin: true,
  },
  {
    id: 'qa',
    name: '测试',
    description: '验证缺陷、推动状态流转',
    permissions: [
      'issue:read', 'issue:create', 'issue:update', 'issue:transition',
      'issue:comment', 'space:read',
    ],
    builtin: true,
  },
  {
    id: 'guest',
    name: '访客',
    description: '只读查看被授权空间',
    permissions: ['issue:read', 'space:read'],
    builtin: true,
  },
];

const SEED_PASSWORD = process.env.NOVA_SEED_PASSWORD || 'nova-demo-2024';

const USERS = [
  { id: 'u-admin', name: '林知远', email: 'admin@nova.dev', roleId: 'admin', password: SEED_PASSWORD, avatarColor: '#3370ff' },
  { id: 'u-pm', name: '周允', email: 'pm@nova.dev', roleId: 'pm', password: SEED_PASSWORD, avatarColor: '#2ea121' },
  { id: 'u-dev', name: '陈嘉禾', email: 'dev@nova.dev', roleId: 'dev', password: SEED_PASSWORD, avatarColor: '#ff8800' },
  { id: 'u-qa', name: '许清', email: 'qa@nova.dev', roleId: 'qa', password: SEED_PASSWORD, avatarColor: '#7f3bf5' },
  { id: 'u-guest', name: '顾言', email: 'guest@nova.dev', roleId: 'guest', password: SEED_PASSWORD, avatarColor: '#8f959e' },
];

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

function issue(seq, spaceId, kind, title, status, extra = {}) {
  return {
    id: `issue-${seq}`,
    key: `${extra.prefix ?? 'REQ'}-${String(seq).padStart(4, '0')}`,
    spaceId,
    kind,
    title,
    description: extra.description ?? '',
    status,
    priority: extra.priority ?? 'P2',
    assigneeId: extra.assigneeId ?? null,
    creatorId: extra.creatorId ?? 'u-pm',
    labels: extra.labels ?? [],
    dueDate: extra.dueDate ?? null,
    estimate: extra.estimate ?? null,
    parentId: null,
    comments: extra.comments ?? [],
    history: [{ at: daysAgo(extra.age ?? 6), actorId: extra.creatorId ?? 'u-pm', action: 'create', detail: '创建' }],
    attachments: [],
    createdAt: daysAgo(extra.age ?? 6),
    updatedAt: daysAgo(extra.ageUpdated ?? 1),
  };
}

export function seedIfEmpty() {
  if (db.data.users.length) return false;

  db.data.roles = ROLES.map((r) => ({ ...r }));
  db.data.users = USERS.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roleId: u.roleId,
    passwordHash: hashPassword(u.password),
    avatarColor: u.avatarColor,
    createdAt: daysAgo(30),
  }));
  db.data.workflows = DEFAULT_WORKFLOWS.map((w) => JSON.parse(JSON.stringify(w)));

  db.data.spaces = [
    {
      id: 'spc-core',
      name: '协同平台研发',
      key: 'CORE',
      description: '类飞书项目平台的核心产品研发空间',
      color: '#3370ff',
      ownerId: 'u-pm',
      members: [
        { userId: 'u-pm', role: 'owner', joinedAt: daysAgo(30) },
        { userId: 'u-dev', role: 'editor', joinedAt: daysAgo(28) },
        { userId: 'u-qa', role: 'editor', joinedAt: daysAgo(28) },
        { userId: 'u-admin', role: 'editor', joinedAt: daysAgo(25) },
        { userId: 'u-guest', role: 'viewer', joinedAt: daysAgo(10) },
      ],
      createdAt: daysAgo(30),
    },
    {
      id: 'spc-growth',
      name: '增长与运营',
      key: 'GROW',
      description: '增长实验与运营工具需求',
      color: '#00b0b0',
      ownerId: 'u-pm',
      members: [
        { userId: 'u-pm', role: 'owner', joinedAt: daysAgo(20) },
        { userId: 'u-dev', role: 'editor', joinedAt: daysAgo(18) },
      ],
      createdAt: daysAgo(20),
    },
  ];

  db.data.issues = [
    issue(1, 'spc-core', 'requirement', '需求管理：看板、列表与自定义状态流转', initialStatus('requirement'),
      { prefix: 'REQ', priority: 'P0', assigneeId: 'u-dev', estimate: 13, labels: ['核心', '需求'], age: 12, ageUpdated: 0.2,
        description: '支持按空间维护需求，提供列表与看板两种视图，状态由工作流驱动，流转需校验权限并记录操作历史。' }),
    issue(2, 'spc-core', 'requirement', '缺陷管理：严重等级、复现步骤与验证闭环', initialStatus('bug') === 'open' ? 'planned' : 'planned',
      { prefix: 'REQ', priority: 'P0', assigneeId: 'u-qa', estimate: 8, labels: ['缺陷'], age: 11, ageUpdated: 0.4,
        description: '缺陷需要独立编号、严重等级、复现环境与验证结论，验证不通过可退回修复中。' }),
    issue(3, 'spc-core', 'requirement', '权限模型：角色、空间成员与字段级可见性', 'in_progress',
      { prefix: 'REQ', priority: 'P1', assigneeId: 'u-dev', estimate: 21, labels: ['权限'], age: 10, ageUpdated: 0.8,
        description: '全局角色决定平台能力，空间角色决定空间内读写，二者取交集生效；管理员可调整角色权限矩阵。' }),
    issue(4, 'spc-core', 'task', '梳理权限矩阵与内置角色权限项', 'in_progress',
      { prefix: 'TASK', priority: 'P1', assigneeId: 'u-dev', estimate: 3, labels: ['权限'], age: 6, ageUpdated: 1 }),
    issue(5, 'spc-core', 'bug', '看板列拖拽后状态未持久化', 'open',
      { prefix: 'BUG', priority: 'P0', assigneeId: 'u-dev', estimate: 2, labels: ['回归'], age: 3, ageUpdated: 0.3,
        description: '复现步骤：打开看板 → 将 BUG-0005 拖到已完成 → 刷新页面 → 状态回到待处理。' }),
    issue(6, 'spc-core', 'bug', '访客角色仍能看到编辑按钮', 'resolved',
      { prefix: 'BUG', priority: 'P1', assigneeId: 'u-dev', estimate: 1, labels: ['权限'], age: 4, ageUpdated: 2,
        description: '前端只读取了全局权限，忽略了空间成员角色，导致 viewer 也能看到编辑入口。' }),
    issue(7, 'spc-core', 'bug', '搜索框输入中文时结果为空', 'closed',
      { prefix: 'BUG', priority: 'P2', assigneeId: 'u-qa', estimate: 1, labels: ['搜索'], age: 9, ageUpdated: 5 }),
    issue(8, 'spc-growth', 'requirement', '邀请链接与空间加入审批', 'planned',
      { prefix: 'REQ', priority: 'P1', assigneeId: 'u-pm', estimate: 5, labels: ['协作'], age: 7, ageUpdated: 3 }),
    issue(9, 'spc-growth', 'task', '整理坏账切换功能的验收清单', 'todo',
      { prefix: 'TASK', priority: 'P2', assigneeId: 'u-guest', estimate: 2, labels: ['验收'], age: 5, ageUpdated: 4 }),
    issue(10, 'spc-core', 'requirement', '交付看板：迭代燃尽与成员负载', 'done',
      { prefix: 'REQ', priority: 'P2', assigneeId: 'u-pm', estimate: 8, labels: ['报表'], age: 15, ageUpdated: 6 }),
  ];
  db.data.issues.find((i) => i.id === 'issue-6').history.unshift({
    at: daysAgo(2), actorId: 'u-dev', action: 'transition', detail: '修复中 → 待验证',
  });
  db.data.issues.find((i) => i.id === 'issue-6').comments = [
    { id: 'cmt-1', authorId: 'u-dev', content: '已在前端补充 spaceRole 判断，viewer 不再渲染编辑入口。', createdAt: daysAgo(2) },
    { id: 'cmt-2', authorId: 'u-qa', content: '需要在回归环境再验证一次只读账号。', createdAt: daysAgo(1.5) },
  ];
  db.data.counters.issue = 10;
  db.data.audit = [{ id: 'aud-init', at: daysAgo(30), actorId: 'u-admin', action: 'system.seed', target: 'project', detail: '初始化演示数据' }];
  db.save();
  return true;
}
