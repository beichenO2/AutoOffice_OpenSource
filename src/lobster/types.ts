export const LOBSTER_EVENT_TYPES = [
  'bug',
  'contract_red',
  'digist_report',
  'git_push_main',
  'scheduled_health_scan',
] as const;

export type LobsterEventType = (typeof LOBSTER_EVENT_TYPES)[number];

export const LOBSTER_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;

export type LobsterSeverity = (typeof LOBSTER_SEVERITIES)[number];

export interface LobsterEvent {
  ts: string;
  type: LobsterEventType;
  source_project: string;
  target_project?: string;
  severity: LobsterSeverity;
  payload: Record<string, unknown>;
  dedup_key: string;
}

export interface LobsterStatusResponse {
  project: string;
  version: string;
  uptime_ms: number;
  recent_events: LobsterEventSummary[];
}

export interface LobsterEventSummary {
  type: LobsterEventType;
  count: number;
  last_ts: string;
}

export interface LobsterHealthResponse {
  ok: boolean;
  error_count: number;
  last_error?: {
    type: LobsterEventType;
    message: string;
    ts: string;
  };
  events_file_ok: boolean;
}

export interface LobsterTestResult {
  passed: number;
  failed: number;
  total: number;
  duration_ms: number;
  error?: string;
}
