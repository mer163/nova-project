import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

function emptyDb() {
  return {
    version: 1,
    users: [],
    roles: [],
    spaces: [],
    workflows: [],
    issues: [],
    sessions: {},
    audit: [],
    counters: { issue: 0 },
  };
}

export class Database {
  constructor(file = DB_PATH) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return emptyDb();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...emptyDb(), ...parsed };
    } catch (err) {
      console.error('[db] 读取失败，使用空库:', err.message);
      return emptyDb();
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  nextIssueNumber() {
    this.data.counters.issue += 1;
    return this.data.counters.issue;
  }

  audit(actorId, action, target, detail) {
    this.data.audit.unshift({
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      actorId,
      action,
      target,
      detail,
    });
    this.data.audit = this.data.audit.slice(0, 500);
  }
}

export const db = new Database();
