import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import './style.css'

async function api(path, method = 'GET', body) {
  const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  if (response.status === 204) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data
}

const states = { requirements: ['pending', 'in_progress', 'done', 'rejected', 'closed'], bugs: ['new', 'assigned', 'fixing', 'verified', 'closed'] }
const labels = { pending: '待处理', in_progress: '进行中', done: '已完成', rejected: '已拒绝', closed: '已关闭', new: '新建', assigned: '已指派', fixing: '修复中', verified: '已验证', fatal: '致命', critical: '严重', normal: '一般', minor: '轻微' }

function Auth({ register, setUser }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  async function submit(event) {
    event.preventDefault()
    try {
      if (register) await api('/register', 'POST', { username, password })
      setUser(await api('/login', 'POST', { username, password }))
      navigate('/requirements')
    } catch (cause) { setError(cause.message) }
  }
  return <main className="auth"><form className="card auth-card" onSubmit={submit}><div className="logo">N</div><h1>Nova 项目</h1><p>让需求和缺陷有序推进</p><label>用户名<input required minLength="3" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label><label>密码<input required minLength="12" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>{error && <div className="error">{error}</div>}<button className="primary">{register ? '注册并进入' : '登录'}</button><Link to={register ? '/login' : '/register'}>{register ? '已有账号？登录' : '没有账号？注册'}</Link></form></main>
}

function Shell({ user, setUser, children }) {
  const navigate = useNavigate()
  async function logout() { await api('/logout', 'POST'); setUser(null); navigate('/login') }
  return <div className="shell"><aside><div className="brand"><span className="logo">N</span> Nova 项目</div><div className="nav-caption">工作空间</div><Link to="/requirements">◇ 需求管理</Link><Link to="/bugs">◈ Bug 管理</Link>{user.role?.name === 'admin' && <><div className="nav-caption">系统设置</div><Link to="/admin">⚙ 用户与角色</Link></>}<div className="profile"><strong>{user.username}</strong><small>{user.role?.name}</small><button onClick={logout}>退出登录</button></div></aside><div className="main"><header>研发协作平台 <span>{user.username}</span></header>{children}</div></div>
}

function Items({ kind }) {
  const isBug = kind === 'bugs'
  const [items, setItems] = useState([])
  const [users, setUsers] = useState([])
  const [filters, setFilters] = useState({ status: '', assigneeId: '', priority: '', severity: '' })
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  async function load() {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
    try { const [records, people] = await Promise.all([api(`/${kind}?${query}`), api('/users')]); setItems(records); setUsers(people); setError('') } catch (cause) { setError(cause.message) }
  }
  useEffect(() => { load() }, [kind, filters.status, filters.assigneeId, filters.priority, filters.severity])
  function filter(name, value) { setFilters(current => ({ ...current, [name]: value })) }
  async function remove(item) { if (!confirm(`删除「${item.title}」？`)) return; try { await api(`/${kind}/${item.id}`, 'DELETE'); load() } catch (cause) { setError(cause.message) } }
  return <main className="content"><div className="heading"><div><small>WORKSPACE / {kind.toUpperCase()}</small><h1>{isBug ? 'Bug 管理' : '需求管理'}</h1><p>追踪每一项工作，从创建到完成。</p></div><button className="primary" onClick={() => setEditing({})}>+ 新建{isBug ? 'Bug' : '需求'}</button></div><section className="card"><div className="filters"><select value={filters.status} onChange={event => filter('status', event.target.value)}><option value="">全部状态</option>{states[kind].map(value => <option key={value} value={value}>{labels[value]}</option>)}</select><select value={filters.assigneeId} onChange={event => filter('assigneeId', event.target.value)}><option value="">全部负责人</option>{users.map(user => <option key={user.id} value={user.id}>{user.username}</option>)}</select>{isBug ? <select value={filters.severity} onChange={event => filter('severity', event.target.value)}><option value="">全部严重程度</option>{['fatal', 'critical', 'normal', 'minor'].map(value => <option key={value} value={value}>{labels[value]}</option>)}</select> : <select value={filters.priority} onChange={event => filter('priority', event.target.value)}><option value="">全部优先级</option>{['P0', 'P1', 'P2', 'P3'].map(value => <option key={value}>{value}</option>)}</select>}</div>{error && <div className="error">{error}</div>}<table><thead><tr><th>标题</th><th>状态</th><th>{isBug ? '严重程度' : '优先级'}</th><th>负责人</th>{!isBug && <th>迭代</th>}<th>更新于</th><th></th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><button className="link-button" onClick={() => setEditing(item)}>{item.title}</button><small>#{item.id}</small></td><td><span className="badge">{labels[item.status]}</span></td><td>{isBug ? labels[item.severity] : item.priority}</td><td>{users.find(user => user.id === item.assigneeId)?.username || '未指派'}</td>{!isBug && <td>{item.iteration || '—'}</td>}<td>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</td><td><button className="link-button danger" onClick={() => remove(item)}>删除</button></td></tr>)}</tbody></table>{items.length === 0 && <div className="empty">暂无记录</div>}</section>{editing && <Editor kind={kind} item={editing} users={users} close={() => setEditing(null)} saved={() => { setEditing(null); load() }} />}</main>
}

function Editor({ kind, item, users, close, saved }) {
  const isBug = kind === 'bugs'
  const [form, setForm] = useState({ title: item.title || '', description: item.description || '', priority: item.priority || 'P2', severity: item.severity || 'normal', status: item.status || (isBug ? 'new' : 'pending'), assigneeId: item.assigneeId || '', iteration: item.iteration || '' })
  const [error, setError] = useState('')
  function update(name, value) { setForm(current => ({ ...current, [name]: value })) }
  async function submit(event) { event.preventDefault(); try { await api(`/${kind}${item.id ? `/${item.id}` : ''}`, item.id ? 'PUT' : 'POST', { ...form, assigneeId: form.assigneeId ? Number(form.assigneeId) : null }); saved() } catch (cause) { setError(cause.message) } }
  return <div className="overlay" onMouseDown={event => { if (event.target === event.currentTarget) close() }}><form className="drawer" onSubmit={submit}><div className="heading"><h2>{item.id ? '编辑' : '新建'}{isBug ? 'Bug' : '需求'}</h2><button type="button" onClick={close}>×</button></div><label>标题<input required maxLength="200" value={form.title} onChange={event => update('title', event.target.value)} /></label><label>描述<textarea rows="5" value={form.description} onChange={event => update('description', event.target.value)} /></label><div className="row"><label>{isBug ? '严重程度' : '优先级'}<select value={isBug ? form.severity : form.priority} onChange={event => update(isBug ? 'severity' : 'priority', event.target.value)}>{(isBug ? ['fatal', 'critical', 'normal', 'minor'] : ['P0', 'P1', 'P2', 'P3']).map(value => <option key={value} value={value}>{labels[value] || value}</option>)}</select></label><label>负责人<select value={form.assigneeId} onChange={event => update('assigneeId', event.target.value)}><option value="">未指派</option>{users.map(user => <option key={user.id} value={user.id}>{user.username}</option>)}</select></label></div>{item.id && <label>状态<select value={form.status} onChange={event => update('status', event.target.value)}>{states[kind].map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>}{!isBug && <label>迭代<input maxLength="100" value={form.iteration} onChange={event => update('iteration', event.target.value)} /></label>}{error && <div className="error">{error}</div>}<div className="actions"><button type="button" onClick={close}>取消</button><button className="primary">保存</button></div></form></div>
}

function Admin() {
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [newUser, setNewUser] = useState({ username: '', password: '', roleId: '' })
  const [newRole, setNewRole] = useState({ name: '', permissions: ['items:read'] })
  const [editingUser, setEditingUser] = useState(null)
  const [editingRole, setEditingRole] = useState(null)
  const [error, setError] = useState('')
  async function load() { try { const [people, access] = await Promise.all([api('/users'), api('/roles')]); setUsers(people); setRoles(access) } catch (cause) { setError(cause.message) } }
  useEffect(() => { load() }, [])
  async function createUser(event) { event.preventDefault(); try { await api('/users', 'POST', { ...newUser, roleId: Number(newUser.roleId) }); setNewUser({ username: '', password: '', roleId: '' }); load() } catch (cause) { setError(cause.message) } }
  async function assign(user, roleId) { try { await api(`/users/${user.id}`, 'PUT', { roleId: Number(roleId) }); load() } catch (cause) { setError(cause.message) } }
  async function saveUser(event) {
    event.preventDefault()
    try { await api(`/users/${editingUser.id}`, 'PUT', { username: editingUser.username, password: editingUser.password, roleId: Number(editingUser.roleId) }); setEditingUser(null); load() } catch (cause) { setError(cause.message) }
  }
  async function saveRole(event) {
    event.preventDefault()
    try { await api(editingRole ? `/roles/${editingRole}` : '/roles', editingRole ? 'PUT' : 'POST', newRole); setNewRole({ name: '', permissions: ['items:read'] }); setEditingRole(null); load() } catch (cause) { setError(cause.message) }
  }
  const permissions = ['items:read', 'items:create', 'items:update', 'items:delete', 'users:read', 'users:write', 'roles:read', 'roles:write']
  return <main className="content">
    <div className="heading"><div><small>SETTINGS / ACCESS</small><h1>用户与角色</h1><p>管理成员账号及基础访问权限。</p></div></div>
    {error && <div className="error">{error}</div>}
    <div className="columns"><section className="card section"><h2>成员</h2>
      <table><thead><tr><th>用户名</th><th>角色</th><th></th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td>{user.username}</td><td><select value={user.roleId} onChange={event => assign(user, event.target.value)}>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></td><td><button className="link-button" onClick={() => setEditingUser({ id: user.id, username: user.username, password: '', roleId: user.roleId })}>编辑</button></td></tr>)}</tbody></table>
      <form onSubmit={createUser}><h3>添加用户</h3><label>用户名<input required minLength="3" value={newUser.username} onChange={event => setNewUser({ ...newUser, username: event.target.value })} /></label><label>密码<input required minLength="12" type="password" value={newUser.password} onChange={event => setNewUser({ ...newUser, password: event.target.value })} /></label><label>角色<select required value={newUser.roleId} onChange={event => setNewUser({ ...newUser, roleId: event.target.value })}><option value="">选择角色</option>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><button className="primary">创建用户</button></form>
      {editingUser && <form onSubmit={saveUser}><h3>编辑用户 #{editingUser.id}</h3><label>用户名<input required minLength="3" value={editingUser.username} onChange={event => setEditingUser({ ...editingUser, username: event.target.value })} /></label><label>新密码（留空不修改）<input type="password" minLength="12" value={editingUser.password} onChange={event => setEditingUser({ ...editingUser, password: event.target.value })} /></label><label>角色<select value={editingUser.roleId} onChange={event => setEditingUser({ ...editingUser, roleId: event.target.value })}>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><div className="actions"><button type="button" onClick={() => setEditingUser(null)}>取消</button><button className="primary">保存用户</button></div></form>}
    </section><section className="card section"><h2>角色</h2>
      {roles.map(role => <div className="role" key={role.id}><strong>{role.name}</strong><small>{role.permissions.join(' · ')}</small>{!['admin', 'member'].includes(role.name) && <button className="link-button" onClick={() => { setEditingRole(role.id); setNewRole({ name: role.name, permissions: role.permissions }) }}>编辑</button>}</div>)}
      <form onSubmit={saveRole}><h3>{editingRole ? '编辑角色' : '新增角色'}</h3><label>名称<input required minLength="2" value={newRole.name} onChange={event => setNewRole({ ...newRole, name: event.target.value })} /></label><div className="permission-list">{permissions.map(permission => <label key={permission}><input type="checkbox" checked={newRole.permissions.includes(permission)} onChange={() => setNewRole({ ...newRole, permissions: newRole.permissions.includes(permission) ? newRole.permissions.filter(value => value !== permission) : [...newRole.permissions, permission] })} />{permission}</label>)}</div><div className="actions">{editingRole && <button type="button" onClick={() => { setEditingRole(null); setNewRole({ name: '', permissions: ['items:read'] }) }}>取消</button>}<button className="primary">{editingRole ? '保存角色' : '创建角色'}</button></div></form>
    </section></div>
  </main>
}

function App() {
  const [user, setUser] = useState(undefined)
  useEffect(() => { api('/me').then(setUser).catch(() => setUser(null)) }, [])
  if (user === undefined) return <div className="loading">正在加载…</div>
  return <Routes><Route path="/login" element={user ? <Navigate to="/requirements" /> : <Auth setUser={setUser} />} /><Route path="/register" element={user ? <Navigate to="/requirements" /> : <Auth register setUser={setUser} />} /><Route path="/requirements" element={user ? <Shell user={user} setUser={setUser}><Items kind="requirements" /></Shell> : <Navigate to="/login" />} /><Route path="/bugs" element={user ? <Shell user={user} setUser={setUser}><Items kind="bugs" /></Shell> : <Navigate to="/login" />} /><Route path="/admin" element={user?.role?.name === 'admin' ? <Shell user={user} setUser={setUser}><Admin /></Shell> : <Navigate to="/requirements" />} /><Route path="*" element={<Navigate to={user ? '/requirements' : '/login'} />} /></Routes>
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>)
