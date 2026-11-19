import { db } from './db.js';

export const DEFAULT_WORKFLOWS = [
  {
    id: 'wf-requirement',
    name: '需求流程',
    kind: 'requirement',
    states: [
      { id: 'backlog', name: '待评估', color: '#8f959e', type: 'open' },
      { id: 'planned', name: '已规划', color: '#3370ff', type: 'open' },
      { id: 'in_progress', name: '开发中', color: '#ff8800', type: 'open' },
      { id: 'in_test', name: '待测试', color: '#7f3bf5', type: 'open' },
      { id: 'done', name: '已完成', color: '#2ea121', type: 'closed' },
      { id: 'cancelled', name: '已取消', color: '#bbbfc4', type: 'closed' },
    ],
    transitions: [
      { from: 'backlog', to: 'planned', name: '纳入规划', permission: 'issue:transition' },
      { from: 'planned', to: 'in_progress', name: '开始开发', permission: 'issue:transition' },
      { from: 'in_progress', to: 'in_test', name: '提交测试', permission: 'issue:transition' },
      { from: 'in_test', to: 'in_progress', name: '测试不通过', permission: 'issue:transition' },
      { from: 'in_test', to: 'done', name: '验收通过', permission: 'issue:transition' },
      { from: 'backlog', to: 'cancelled', name: '取消需求', permission: 'issue:delete' },
      { from: 'planned', to: 'cancelled', name: '取消需求', permission: 'issue:delete' },
      { from: 'done', to: 'in_progress', name: '重新打开', permission: 'issue:transition' },
    ],
  },
  {
    id: 'wf-bug',
    name: '缺陷流程',
    kind: 'bug',
    states: [
      { id: 'open', name: '待处理', color: '#f54a45', type: 'open' },
      { id: 'in_progress', name: '修复中', color: '#ff8800', type: 'open' },
      { id: 'resolved', name: '待验证', color: '#7f3bf5', type: 'open' },
      { id: 'closed', name: '已关闭', color: '#2ea121', type: 'closed' },
      { id: 'wontfix', name: '不予修复', color: '#bbbfc4', type: 'closed' },
    ],
    transitions: [
      { from: 'open', to: 'in_progress', name: '开始修复', permission: 'issue:transition' },
      { from: 'in_progress', to: 'resolved', name: '修复完成', permission: 'issue:transition' },
      { from: 'resolved', to: 'closed', name: '验证通过', permission: 'issue:transition' },
      { from: 'resolved', to: 'in_progress', name: '验证不通过', permission: 'issue:transition' },
      { from: 'closed', to: 'open', name: '重新打开', permission: 'issue:transition' },
      { from: 'open', to: 'wontfix', name: '不予修复', permission: 'issue:delete' },
    ],
  },
  {
    id: 'wf-task',
    name: '任务流程',
    kind: 'task',
    states: [
      { id: 'todo', name: '待开始', color: '#8f959e', type: 'open' },
      { id: 'in_progress', name: '进行中', color: '#3370ff', type: 'open' },
      { id: 'done', name: '已完成', color: '#2ea121', type: 'closed' },
    ],
    transitions: [
      { from: 'todo', to: 'in_progress', name: '开始', permission: 'issue:transition' },
      { from: 'in_progress', to: 'done', name: '完成', permission: 'issue:transition' },
      { from: 'done', to: 'in_progress', name: '重新打开', permission: 'issue:transition' },
    ],
  },
];

export function workflowFor(kind) {
  return db.data.workflows.find((w) => w.kind === kind) ?? DEFAULT_WORKFLOWS.find((w) => w.kind === kind);
}

export function initialStatus(kind) {
  return workflowFor(kind)?.states[0]?.id ?? 'backlog';
}

export function findState(kind, statusId) {
  return workflowFor(kind)?.states.find((s) => s.id === statusId) ?? null;
}

export function availableTransitions(kind, statusId) {
  return (workflowFor(kind)?.transitions ?? []).filter((t) => t.from === statusId);
}
