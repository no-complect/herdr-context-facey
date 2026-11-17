export type Provider = "codex" | "claude" | "grok" | "agy";
export type CategoryId =
  | "runtime"
  | "instructions"
  | "memory"
  | "skills"
  | "tools"
  | "environment"
  | "user"
  | "files"
  | "calls"
  | "results"
  | "assistant"
  | "summary";

export interface SessionIdentity {
  provider: Provider;
  id: string;
  path: string;
}

export interface ContextEvent {
  id: string;
  source: string;
  line: number;
  field: string;
  record_hash: string;
  category: CategoryId;
  label: string;
  teaser: string;
  segment: number;
  turn: number;
  tokens: number;
  bytes: number;
  timestamp?: string | null;
  persistent?: string | null;
  protected?: boolean;
}

export interface Usage {
  input: number;
  cached?: number | null;
  output?: number | null;
  window?: number | null;
  kind?: string;
  label?: string;
}

export interface UsageSample extends Usage {
  afterId: number;
}

export interface Candidate {
  id: string;
  path: string;
  name: string;
  updated: number;
  cwd?: string | null;
}

export interface Snapshot {
  version: 1;
  status: "snapshot";
  session: SessionIdentity;
  revision: string;
  partial: boolean;
  capabilities: { compaction: boolean; historical_usage: boolean };
  events: ContextEvent[];
  usage_samples: UsageSample[];
  reported?: Usage | null;
  candidates?: Candidate[];
  notes: string[];
  model?: string | null;
  method?: string;
  match?: string;
  files?: number;
}

export interface SelectionRequired {
  version: 1;
  status: "selection_required";
  code: "no_session" | "ambiguous_session";
  reason: string;
  candidates: Candidate[];
}

export interface Unchanged {
  version: 1;
  status: "unchanged";
  session: SessionIdentity;
  revision: string;
  candidates?: Candidate[];
}

export interface Detail {
  version: 1;
  status: "detail";
  text: string;
  truncated?: boolean;
}

export type PanelData = Snapshot | SelectionRequired;
export type SummaryResponse = PanelData | Unchanged;
export type ReaderResponse = SummaryResponse | Detail;

export interface SummaryRequest {
  action?: "summary";
  provider?: Provider;
  address?: string;
  space?: string | null;
  tab?: string | null;
  pid?: number;
  title?: string;
  cwd?: string | null;
  session_id?: string;
  path?: string;
  revision?: string | null;
}

export interface DetailRequest {
  action: "detail";
  session: SessionIdentity;
  revision: string;
  source: string;
  line: number;
  field: string;
  record_hash: string;
  protected?: boolean;
}

export type ReaderRequest = SummaryRequest | DetailRequest;
export interface ReadSession {
  (request: DetailRequest, timeout?: number): Promise<Detail>;
  (request: SummaryRequest, timeout?: number): Promise<SummaryResponse>;
}

export type Exec = (
  command: string,
  args: string[],
  options: { timeout: number },
) => Promise<{ code: number; stdout: string }>;

export interface Target extends Omit<SummaryRequest, "provider"> {
  address: string;
  provider: Provider | null;
  title: string;
}

export interface Focus {
  space?: string | null;
  tab?: string | null;
  pane?: string | null;
  terminal?: string | null;
  shown?: string | null;
  agent?: string | null;
  cwd?: string | null;
}

export interface ProgramEntry {
  app?: string | null;
  report?: { app?: string; title?: string };
  program?: { key?: string };
}

export interface Pane extends ProgramEntry {
  pane?: string;
  terminal?: string | null;
  tab?: string | null;
  status?: string | null;
  title?: string;
  cwd?: string | null;
  zoomed?: boolean;
}

export interface Terminal extends ProgramEntry {
  address?: string;
  foreground?: { pid?: number; cwd?: string };
  title?: string;
  cwd?: string;
  labels?: Record<string, string>;
}

export interface InspectorProps {
  overlay?: string;
  pane?: string;
  blockId?: string;
  target?: Target;
  selectedPath?: string;
}
