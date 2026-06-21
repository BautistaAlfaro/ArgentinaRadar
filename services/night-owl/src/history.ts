/**
 * Night Owl — Execution History (in-memory)
 *
 * Simple in-memory ring buffer that keeps the last N job executions.
 * In a future phase this can be backed by SQLite / Redis.
 */

interface ExecutionRecord {
  id: string;
  job: string;
  status: 'completed' | 'failed';
  startedAt: string;
  finishedAt: string;
  elapsed: number;
  error?: string;
}

const MAX_RECORDS = 500;
const records: ExecutionRecord[] = [];

let counter = 0;

export function addRecord(rec: Omit<ExecutionRecord, 'id'>): void {
  records.unshift({ id: `exec-${++counter}`, ...rec });
  if (records.length > MAX_RECORDS) {
    records.length = MAX_RECORDS;
  }
}

export function getHistory(limit = 50): ExecutionRecord[] {
  return records.slice(0, limit);
}

export function getLastRun(jobName: string): ExecutionRecord | undefined {
  return records.find((r) => r.job === jobName);
}
