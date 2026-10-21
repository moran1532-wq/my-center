import type { Recipient, RecipientStore, ReportData, ReportStore, QuestionStat, StatsStore } from "./types.js";

/** Where a list of records lives - a JSON file on the server, browser storage in the preview, memory in tests. */
export interface Persist<T> {
  read(): Promise<T[]>;
  write(items: T[]): Promise<void>;
}

export class MemoryPersist<T> implements Persist<T> {
  private items: T[] = [];
  async read() {
    return structuredClone(this.items);
  }
  async write(items: T[]) {
    this.items = structuredClone(items);
  }
}

/** Keep stats for a year at most - the report only needs recent ones. */
const STATS_KEEP_MS = 365 * 86400000;

export class PersistedStats implements StatsStore {
  private readonly p: Persist<QuestionStat>;
  constructor(p: Persist<QuestionStat>) {
    this.p = p;
  }
  async record(stat: QuestionStat) {
    const cutoff = Date.now() - STATS_KEEP_MS;
    const all = (await this.p.read()).filter((s) => Date.parse(s.at) > cutoff);
    all.push(stat);
    await this.p.write(all);
  }
  async since(fromIso: string) {
    return (await this.p.read()).filter((s) => s.at > fromIso); // strictly after: a stat belongs to one report only
  }
}

export class PersistedRecipients implements RecipientStore {
  private readonly p: Persist<Recipient>;
  private readonly newId: () => string;
  constructor(p: Persist<Recipient>, newId: () => string) {
    this.p = p;
    this.newId = newId;
  }
  list() {
    return this.p.read();
  }
  async add(r: Omit<Recipient, "id">) {
    const all = await this.p.read();
    const existing = all.find((x) => x.email.toLowerCase() === r.email.toLowerCase());
    if (existing) return existing;
    const rec = { ...r, id: this.newId() };
    await this.p.write([...all, rec]);
    return rec;
  }
  async remove(id: string) {
    const all = await this.p.read();
    const rest = all.filter((x) => x.id !== id);
    await this.p.write(rest);
    return rest.length !== all.length;
  }
}

/** Keeps the most recent reports. */
const MAX_REPORTS = 200;

export class PersistedReports implements ReportStore {
  private readonly p: Persist<ReportData>;
  constructor(p: Persist<ReportData>) {
    this.p = p;
  }
  async list() {
    return (await this.p.read()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    return (await this.p.read()).find((r) => r.id === id);
  }
  async save(r: ReportData) {
    const all = (await this.p.read()).filter((x) => x.id !== r.id);
    all.push(r);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    await this.p.write(all.slice(0, MAX_REPORTS));
  }
}
