import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from './main.jsx'
import './requirements.css'

const steps = [
  ['requirement_review', '需求评审'], ['technical_review', '技术评审'], ['development', '并行开发'],
  ['show_case', 'Show Case'], ['first_test', '第一轮测试'], ['product_walkthrough', '产品和设计走查'],
  ['regression_test', '第二/三轮测试'], ['service_online', '功能服务上线'], ['launch_review', 'Launch Review'],
  ['freeze', '封版'], ['integration_test', '集成测试'], ['submission', '提审'], ['finished', '已结束']
]
const stepName = Object.fromEntries([...steps, ['rejected', '已拒绝'], ['closed', '已关闭']])
const endpoints = [['client', '客户端'], ['server', '服务端'], ['h5', 'H5'], ['ai_hub', 'AI Hub'], ['audio', '音视频'], ['admin', '管理后台'], ['ads', '广告服务']]
const endpointName = Object.fromEntries([...endpoints, ['test_case', '用例设计与评审']])
const roles = [
  ['pm', '产品经理'], ['version_owner', '版本负责人'], ['requirement_owner', '需求负责人'],
  ['client_developer', '客户端开发'], ['server_developer', '服务端开发'], ['h5_developer', 'H5 开发'],
  ['ai_hub_developer', 'AI Hub 开发'], ['audio_developer', '音视频开发'], ['admin_developer', '管理后台开发'],
  ['ads_developer', '广告服务开发'], ['ui_ux', 'UI/UX'], ['test', '测试'], ['da', 'DA'], ['technical_review_leader', '技术评审负责人']
]
const templates = [['feature', '产品需求'], ['optimization', '体验优化'], ['technical', '技术需求']]
const risks = [['none', '无风险'], ['low', '低'], ['medium', '中'], ['high', '高']]
const trackStatuses = [['not_started', '待开始'], ['in_progress', '进行中'], ['done', '已完成'], ['skipped', '跳过']]
const date = value => value ? new Date(value).toLocaleDateString('zh-CN') : '—'
const person = (users, id) => users.find(user => user.id === Number(id))?.username || '未指派'
const label = (pairs, value) => pairs.find(([key]) => key === value)?.[1] || value || '—'
const draftKey = 'nova-requirement-draft-v1'

function emptyForm(user) {
  return { title: '', description: '', priority: 'P2', template: 'feature', productDirection: '', businessLine: '', endpoints: [], risk: 'none', plannedVersion: '', actualVersion: '', expectedAt: '', iteration: '', requirementDoc: '', designDoc: '', technicalDoc: '', testCaseDoc: '', roles: { requirement_owner: user.id }, watchers: [], relatedBugIds: [], assigneeId: null, status: 'requirement_review' }
}

function normalize(item, user) {
  const base = emptyForm(user)
  return { ...base, ...item, template: item.template || 'feature', risk: item.risk || 'none', roles: { ...base.roles, ...(item.roles || {}) }, endpoints: item.endpoints || [], watchers: item.watchers || [], relatedBugIds: item.relatedBugIds || [] }
}

function RequirementForm({ item, user, users, bugs, close, saved }) {
  const [form, setForm] = useState(() => item?.id ? normalize(item, user) : emptyForm(user))
  const [error, setError] = useState('')
  const [again, setAgain] = useState(false)
  const [draftMessage, setDraftMessage] = useState('')
  const canAssign = !item?.id || user.role?.name === 'admin' || Number(item.ownerId) === user.id
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const toggle = (key, value) => update(key, form[key].includes(value) ? form[key].filter(entry => entry !== value) : [...form[key], value])
  const setRole = (key, value) => setForm(current => { const next = { ...current.roles }; if (value) next[key] = Number(value); else delete next[key]; return { ...current, roles: next } })
  function saveDraft() { localStorage.setItem(draftKey, JSON.stringify(form)); setDraftMessage('草稿已保存在当前浏览器'); setError('') }
  function restoreDraft() { try { const raw = localStorage.getItem(draftKey); if (raw) { setForm(normalize(JSON.parse(raw), user)); setDraftMessage('已恢复本机草稿') } } catch { setError('草稿无法读取') } }
  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!form.endpoints.length && !item?.id) { setError('请至少选择一个涉及端'); return }
    if (!form.roles.requirement_owner) { setError('请选择需求负责人'); return }
    try {
      const result = await api(item?.id ? `/requirements/${item.id}` : '/requirements', item?.id ? 'PUT' : 'POST', form)
      if (!item?.id) localStorage.removeItem(draftKey)
      if (again && !item?.id) { setForm(emptyForm(user)); setDraftMessage('已创建，可继续填写下一条'); saved(result, true) }
      else saved(result, false)
    } catch (cause) { setError(cause.message) }
  }
  return <div className="overlay requirement-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <form className="drawer requirement-drawer" onSubmit={submit}>
      <div className="requirement-drawer-head"><div><small>WORK ITEM / REQUIREMENT</small><h2>{item?.id ? `编辑需求 #${item.id}` : '创建需求'}</h2></div><button type="button" className="quiet" onClick={close} aria-label="关闭">×</button></div>
      {!item?.id && <button type="button" className="draft-restore" onClick={restoreDraft}>恢复本机草稿</button>}
      {draftMessage && <p className="inline-note">{draftMessage}</p>}
      <section className="form-section"><h3>基本信息</h3>
        <label>名称 <em>*</em><input required maxLength="200" value={form.title} onChange={event => update('title', event.target.value)} placeholder="一句话说明需求" /></label>
        <label>描述<textarea rows="5" maxLength="100000" value={form.description} onChange={event => update('description', event.target.value)} placeholder="背景、核心功能点与预期收益" /></label>
        <div className="form-grid"><label>需求模板<select value={form.template} onChange={event => update('template', event.target.value)}>{templates.map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label>优先级<select value={form.priority} onChange={event => update('priority', event.target.value)}>{['P0', 'P1', 'P2', 'P3'].map(value => <option key={value}>{value}</option>)}</select></label></div>
        <div className="form-grid"><label>产品方向<input maxLength="100" value={form.productDirection} onChange={event => update('productDirection', event.target.value)} placeholder="如：客户端、直播" /></label><label>业务线<input maxLength="100" value={form.businessLine} onChange={event => update('businessLine', event.target.value)} placeholder="如：增长" /></label></div>
        <div className="form-grid"><label>风险<select value={form.risk} onChange={event => update('risk', event.target.value)}>{risks.map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label>负责人<select disabled={!canAssign} value={form.assigneeId || ''} onChange={event => update('assigneeId', event.target.value ? Number(event.target.value) : null)}><option value="">未指派</option>{users.map(person => <option key={person.id} value={person.id}>{person.username}</option>)}</select></label></div>
        <fieldset><legend>涉及端 <em>*</em></legend><div className="choice-grid">{endpoints.map(([key, value]) => <label key={key}><input type="checkbox" disabled={!canAssign || Boolean(item?.developmentStarted)} checked={form.endpoints.includes(key)} onChange={() => toggle('endpoints', key)} />{value}</label>)}</div>{item?.developmentStarted && <p className="section-hint">需求已进入过开发阶段，涉及端不可再修改。</p>}</fieldset>
      </section>
      <section className="form-section"><h3>人员</h3><p className="section-hint">协作角色只用于本条需求，不改变平台账号权限。</p>
        <div className="form-grid">{roles.map(([key, value]) => <label key={key}>{value}{key === 'requirement_owner' && <em>*</em>}<select disabled={!canAssign} value={form.roles[key] || ''} onChange={event => setRole(key, event.target.value)}><option value="">待指定</option>{users.map(person => <option key={person.id} value={person.id}>{person.username}</option>)}</select></label>)}</div>
        <label>关注人<select multiple value={form.watchers.map(String)} onChange={event => update('watchers', Array.from(event.target.selectedOptions, option => Number(option.value)))}>{users.map(person => <option key={person.id} value={person.id}>{person.username}</option>)}</select><small>可按 Ctrl / Command 多选</small></label>
      </section>
      <section className="form-section"><h3>文档与关联</h3><div className="form-grid">{[['requirementDoc', '需求文档'], ['designDoc', 'UI/UX 设计稿'], ['technicalDoc', '技术文档'], ['testCaseDoc', 'Test Case']].map(([key, value]) => <label key={key}>{value}<input type="url" value={form[key]} onChange={event => update(key, event.target.value)} placeholder="https://" /></label>)}</div>
        <label>关联 Bug<select multiple value={form.relatedBugIds.map(String)} onChange={event => update('relatedBugIds', Array.from(event.target.selectedOptions, option => Number(option.value)))}>{bugs.map(bug => <option key={bug.id} value={bug.id}>#{bug.id} {bug.title}</option>)}</select></label>
      </section>
      <section className="form-section"><h3>版本与进度</h3><div className="form-grid"><label>规划版本<input disabled={!canAssign} maxLength="100" value={form.plannedVersion} onChange={event => update('plannedVersion', event.target.value)} /></label><label>实际上线版本<input disabled={!canAssign} maxLength="100" value={form.actualVersion} onChange={event => update('actualVersion', event.target.value)} /></label><label>迭代<input maxLength="100" value={form.iteration} onChange={event => update('iteration', event.target.value)} /></label><label>预计完成日期<input type="date" value={form.expectedAt} onChange={event => update('expectedAt', event.target.value)} /></label></div></section>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="requirement-form-actions">{!item?.id && <><label className="inline-checkbox"><input type="checkbox" checked={again} onChange={event => setAgain(event.target.checked)} />连续创建</label><button type="button" onClick={saveDraft}>保存本机草稿</button></>}<button type="button" onClick={close}>取消</button><button className="primary">{item?.id ? '保存修改' : '确认创建'}</button></div>
    </form>
  </div>
}

export function RequirementList({ user }) {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [users, setUsers] = useState([])
  const [bugs, setBugs] = useState([])
  const [filters, setFilters] = useState({ q: '', status: '', ownerId: '', priority: '', template: '', sort: 'created_desc' })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    try { const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)); const records = await api(`/requirements?${query}`); setItems(records); setError('') } catch (cause) { setError(cause.message) }
  }
  useEffect(() => { Promise.all([api('/users'), api('/bugs')]).then(([people, defects]) => { setUsers(people); setBugs(defects) }).catch(cause => setError(cause.message)) }, [])
  useEffect(() => { load() }, [filters.q, filters.status, filters.ownerId, filters.priority, filters.template, filters.sort])
  const filter = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  async function remove(item) { if (!window.confirm(`删除需求 #${item.id}「${item.title}」？`)) return; try { await api(`/requirements/${item.id}`, 'DELETE'); load() } catch (cause) { setError(cause.message) } }
  return <main className="content requirement-page"><div className="heading"><div><small>WORKSPACE / REQUIREMENTS</small><h1>需求管理</h1><p>按流程推进需求，关联各端开发与测试。</p></div><button className="primary" onClick={() => setCreating(true)}>+ 创建需求</button></div>
    <section className="card requirement-list"><div className="requirement-toolbar"><input aria-label="搜索需求" placeholder="搜索需求名称" value={filters.q} onChange={event => filter('q', event.target.value)} /><select aria-label="状态" value={filters.status} onChange={event => filter('status', event.target.value)}><option value="">全部状态</option>{steps.map(([key, value]) => <option key={key} value={key}>{value}</option>)}<option value="rejected">已拒绝</option><option value="closed">已关闭</option></select><select aria-label="需求负责人" value={filters.ownerId} onChange={event => filter('ownerId', event.target.value)}><option value="">全部负责人</option>{users.map(person => <option key={person.id} value={person.id}>{person.username}</option>)}</select><select aria-label="优先级" value={filters.priority} onChange={event => filter('priority', event.target.value)}><option value="">全部优先级</option>{['P0', 'P1', 'P2', 'P3'].map(value => <option key={value}>{value}</option>)}</select><select aria-label="模板" value={filters.template} onChange={event => filter('template', event.target.value)}><option value="">全部模板</option>{templates.map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select><select aria-label="排序" value={filters.sort} onChange={event => filter('sort', event.target.value)}><option value="created_desc">最新创建</option><option value="created_asc">最早创建</option><option value="priority">优先级</option><option value="id">编号倒序</option></select></div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="requirement-table-scroll"><table className="requirement-table"><thead><tr><th>名称</th><th>需求状态</th><th>需求负责人</th><th>当前处理人</th><th>优先级</th><th>测试</th><th>创建者</th><th>提交时间</th><th>需求类型</th><th>关联 Bug</th><th></th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td className="title-cell"><Link to={`/requirements/${item.id}`}>{item.title}</Link><small>#{item.id}</small></td><td><span className="status-pill">{stepName[item.status] || item.status}</span></td><td>{person(users, item.ownerId || item.roles?.requirement_owner || item.assigneeId)}</td><td>{person(users, item.currentOperatorId)}</td><td><span className={`priority-pill priority-${item.priority}`}>{item.priority}</span></td><td>{person(users, item.roles?.test)}</td><td>{person(users, item.createdById)}</td><td>{date(item.createdAt)}</td><td>{label(templates, item.template)}</td><td>{item.relatedBugIds?.length || 0}</td><td>{(user.role?.name === "admin" || Number(item.ownerId) === user.id) && <button className="link-button danger" onClick={() => remove(item)}>删除</button>}</td></tr>)}</tbody></table></div>{items.length === 0 && <div className="empty">暂无符合条件的需求</div>}</section>
    {creating && <RequirementForm user={user} users={users} bugs={bugs} close={() => setCreating(false)} saved={(item, again) => { load(); if (!again) { setCreating(false); navigate(`/requirements/${item.id}`) } }} />}
  </main>
}

function Info({ title, value }) { return <div className="detail-info"><dt>{title}</dt><dd>{value || '—'}</dd></div> }
function Doc({ title, value }) { return <Info title={title} value={value ? <a href={value} target="_blank" rel="noreferrer">查看文档 ↗</a> : '—'} /> }

export function RequirementDetail({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [item, setItem] = useState(null)
  const [history, setHistory] = useState([])
  const [users, setUsers] = useState([])
  const [bugs, setBugs] = useState([])
  const [tab, setTab] = useState('detail')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  async function load() { try { const [record, records, people, defects] = await Promise.all([api(`/requirements/${id}`), api(`/requirements/${id}/history`), api('/users'), api('/bugs')]); setItem(record); setHistory(records); setUsers(people); setBugs(defects); setError('') } catch (cause) { setError(cause.message) } }
  useEffect(() => { load() }, [id])
  async function changeStatus(status) { const reason = ['closed', 'rejected'].includes(status) ? window.prompt('请填写关闭或拒绝原因') : ''; if (reason === null) return; try { const changed = await api(`/requirements/${id}`, 'PUT', { status, reason }); setItem(changed); setHistory(await api(`/requirements/${id}/history`)); setError('') } catch (cause) { setError(cause.message) } }
  async function changeTrack(track, status) { const reason = status === 'skipped' ? window.prompt('请填写跳过原因') : ''; if (reason === null) return; try { setItem(await api(`/requirements/${id}/tracks/${track}`, 'PUT', { status, reason })); setHistory(await api(`/requirements/${id}/history`)); setError('') } catch (cause) { setError(cause.message) } }
  if (!item) return <main className="content requirement-page"><Link to="/requirements">← 返回需求列表</Link>{error ? <div className="error">{error}</div> : <p>正在加载需求…</p>}</main>
  const index = steps.findIndex(([key]) => key === item.status)
  const tracks = [...(item.endpoints || []), 'test_case']
  const admin = user.role?.name === 'admin'
  const canMove = admin || Number(item.currentOperatorId || item.ownerId || item.assigneeId || item.createdById) === user.id
  const canTrack = track => admin || Number(item.ownerId) === user.id || Number(item.roles?.pm) === user.id || Number(item.roles?.[track === 'test_case' ? 'test' : `${track}_developer`]) === user.id
  return <main className="content requirement-page"><Link className="back-link" to="/requirements">← 需求列表</Link><div className="heading detail-heading"><div><small>REQUIREMENT / #{item.id}</small><h1>{item.title}</h1><p>创建于 {date(item.createdAt)} · 最近更新 {date(item.updatedAt)}</p></div><div className="heading-actions"><span className="status-pill">{stepName[item.status] || item.status}</span><button className="primary" onClick={() => setEditing(true)}>编辑需求</button></div></div>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="detail-tabs"><button className={tab === 'detail' ? 'active' : ''} onClick={() => setTab('detail')}>基本信息</button><button className={tab === 'workflow' ? 'active' : ''} onClick={() => setTab('workflow')}>工作进展</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>操作记录</button></div>
    {tab === 'detail' && <div className="detail-stack"><section className="card detail-card"><h2>基本信息</h2><div className="detail-grid"><Info title="描述" value={<span className="preline">{item.description || '—'}</span>} /><Info title="优先级" value={item.priority} /><Info title="需求模板" value={label(templates, item.template)} /><Info title="需求状态" value={stepName[item.status]} /><Info title="产品方向" value={item.productDirection} /><Info title="业务线" value={item.businessLine} /><Info title="涉及端" value={item.endpoints?.map(key => endpointName[key]).join('、')} /><Info title="风险" value={label(risks, item.risk)} /><Info title="需求负责人" value={person(users, item.ownerId || item.roles?.requirement_owner || item.assigneeId)} /><Info title="当前处理人" value={person(users, item.currentOperatorId)} /></div></section>
      <section className="card detail-card"><h2>人员</h2><div className="detail-grid">{roles.map(([key, value]) => <Info key={key} title={value} value={person(users, item.roles?.[key])} />)}<Info title="关注人" value={item.watchers?.map(id => person(users, id)).join('、')} /></div></section>
      <section className="card detail-card"><h2>文档</h2><div className="detail-grid"><Doc title="需求文档" value={item.requirementDoc} /><Doc title="UI/UX 设计稿" value={item.designDoc} /><Doc title="技术文档" value={item.technicalDoc} /><Doc title="Test Case" value={item.testCaseDoc} /></div></section>
      <section className="card detail-card"><h2>版本与关联</h2><div className="detail-grid"><Info title="规划版本" value={item.plannedVersion} /><Info title="实际上线版本" value={item.actualVersion} /><Info title="迭代" value={item.iteration} /><Info title="预计完成日期" value={item.expectedAt} /><Info title="关联 Bug" value={item.relatedBugIds?.length ? item.relatedBugIds.map(bugId => <span key={bugId} className="related-bug">#{bugId} {bugs.find(bug => bug.id === bugId)?.title || 'Bug'}</span>) : '—'} /></div></section></div>}
    {tab === 'workflow' && <div className="detail-stack"><section className="card detail-card"><h2>需求流程</h2><div className="workflow-strip">{steps.map(([key, value], position) => <div key={key} className={`workflow-step ${item.status === key ? 'current' : ''} ${index > position ? 'passed' : ''}`}><span>{position + 1}</span>{value}</div>)}</div><p className="section-hint">每次只推进或回退一个节点；开发阶段所有涉及端及用例设计须完成或跳过，才能进入 Show Case。</p><div className="workflow-actions">{canMove && index > 0 && index < steps.length - 1 && <button onClick={() => changeStatus(steps[index - 1][0])}>退回：{steps[index - 1][1]}</button>}{canMove && index >= 0 && index < steps.length - 1 && <button className="primary" onClick={() => changeStatus(steps[index + 1][0])}>推进：{steps[index + 1][1]}</button>}{canMove && ['requirement_review', 'technical_review'].includes(item.status) && <button onClick={() => changeStatus('rejected')}>拒绝</button>}{canMove && index >= 0 && index < steps.length - 1 && <button onClick={() => changeStatus('closed')}>关闭</button>}</div></section>
      <section className="card detail-card"><h2>并行开发与用例设计</h2><div className="track-grid">{tracks.map(track => <label key={track}><span>{endpointName[track]}</span><select disabled={item.status !== 'development' || !canTrack(track)} value={item.tracks?.[track] || 'not_started'} onChange={event => changeTrack(track, event.target.value)}>{trackStatuses.filter(([key]) => key !== 'skipped' || admin || Number(item.roles?.pm) === user.id).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>)}</div>{item.status !== 'development' && <p className="section-hint">并行任务仅在开发阶段可更新。</p>}</section></div>}
    {tab === 'history' && <section className="card detail-card"><h2>操作记录</h2>{history.length ? <div className="history-list">{history.map(entry => <div key={entry.id}><strong>{entry.action === 'create' ? '创建需求' : entry.action === 'track' ? `${endpointName[entry.track]}：${label(trackStatuses, entry.fromStatus)} → ${label(trackStatuses, entry.toStatus)}` : `${stepName[entry.fromStatus]} → ${stepName[entry.toStatus]}`}{entry.reason ? ` · 原因：${entry.reason}` : ''}</strong><small>{person(users, entry.actorId)} · {new Date(entry.createdAt).toLocaleString('zh-CN')}</small></div>)}</div> : <p className="section-hint">旧需求尚无可追溯的历史操作。</p>}</section>}
    {editing && <RequirementForm item={item} user={user} users={users} bugs={bugs} close={() => setEditing(false)} saved={record => { setItem(record); setEditing(false); load() }} />}
  </main>
}
