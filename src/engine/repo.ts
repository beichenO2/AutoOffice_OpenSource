/** Typed repository facade over {@link EngineStore}. */
import { EngineStore } from './store.js';
import type {
  AgentTask,
  Annotation,
  Brief,
  EditIntent,
  Message,
  Project,
  Proposal,
  Revision,
  SourceMap,
  ToolRun,
  VerificationRun,
} from './types.js';

export const COLLECTIONS = {
  projects: 'projects',
  revisions: 'revisions',
  annotations: 'annotations',
  editIntents: 'editIntents',
  proposals: 'proposals',
  briefs: 'briefs',
  tasks: 'tasks',
  toolRuns: 'toolRuns',
  verificationRuns: 'verificationRuns',
  messages: 'messages',
  sourceMaps: 'sourceMaps',
} as const;

export class Repo {
  readonly store: EngineStore;

  constructor(store: EngineStore) {
    this.store = store;
  }

  // Projects
  putProject(p: Project): Promise<Project> {
    return this.store.put(COLLECTIONS.projects, p);
  }
  getProject(id: string): Promise<Project | null> {
    return this.store.get<Project>(COLLECTIONS.projects, id);
  }
  listProjects(): Promise<Project[]> {
    return this.store.list<Project>(COLLECTIONS.projects);
  }

  // Revisions
  putRevision(r: Revision): Promise<Revision> {
    return this.store.put(COLLECTIONS.revisions, r);
  }
  getRevision(id: string): Promise<Revision | null> {
    return this.store.get<Revision>(COLLECTIONS.revisions, id);
  }
  async listRevisions(projectId: string): Promise<Revision[]> {
    const all = await this.store.list<Revision>(COLLECTIONS.revisions);
    return all
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Annotations
  putAnnotation(a: Annotation): Promise<Annotation> {
    return this.store.put(COLLECTIONS.annotations, a);
  }
  getAnnotation(id: string): Promise<Annotation | null> {
    return this.store.get<Annotation>(COLLECTIONS.annotations, id);
  }
  async listAnnotations(projectId: string): Promise<Annotation[]> {
    const all = await this.store.list<Annotation>(COLLECTIONS.annotations);
    return all.filter((a) => a.projectId === projectId);
  }

  // Edit intents
  putEditIntent(e: EditIntent): Promise<EditIntent> {
    return this.store.put(COLLECTIONS.editIntents, e);
  }
  getEditIntent(id: string): Promise<EditIntent | null> {
    return this.store.get<EditIntent>(COLLECTIONS.editIntents, id);
  }

  // Proposals
  putProposal(p: Proposal): Promise<Proposal> {
    return this.store.put(COLLECTIONS.proposals, p);
  }
  getProposal(id: string): Promise<Proposal | null> {
    return this.store.get<Proposal>(COLLECTIONS.proposals, id);
  }

  // Briefs
  putBrief(b: Brief): Promise<Brief> {
    return this.store.put(COLLECTIONS.briefs, b);
  }
  getBrief(id: string): Promise<Brief | null> {
    return this.store.get<Brief>(COLLECTIONS.briefs, id);
  }

  // Tasks
  putTask(t: AgentTask): Promise<AgentTask> {
    return this.store.put(COLLECTIONS.tasks, t);
  }
  getTask(id: string): Promise<AgentTask | null> {
    return this.store.get<AgentTask>(COLLECTIONS.tasks, id);
  }
  async listTasks(projectId: string): Promise<AgentTask[]> {
    const all = await this.store.list<AgentTask>(COLLECTIONS.tasks);
    return all
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Tool runs
  putToolRun(t: ToolRun): Promise<ToolRun> {
    return this.store.put(COLLECTIONS.toolRuns, t);
  }
  getToolRun(id: string): Promise<ToolRun | null> {
    return this.store.get<ToolRun>(COLLECTIONS.toolRuns, id);
  }
  async findToolRunByIdempotencyKey(key: string): Promise<ToolRun | null> {
    const all = await this.store.list<ToolRun>(COLLECTIONS.toolRuns);
    return all.find((t) => t.idempotencyKey === key) ?? null;
  }

  // Verification runs
  putVerificationRun(v: VerificationRun): Promise<VerificationRun> {
    return this.store.put(COLLECTIONS.verificationRuns, v);
  }
  getVerificationRun(id: string): Promise<VerificationRun | null> {
    return this.store.get<VerificationRun>(COLLECTIONS.verificationRuns, id);
  }

  // Messages
  putMessage(m: Message): Promise<Message> {
    return this.store.put(COLLECTIONS.messages, m);
  }
  async listMessages(projectId: string): Promise<Message[]> {
    const all = await this.store.list<Message>(COLLECTIONS.messages);
    return all
      .filter((m) => m.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // Source maps
  putSourceMap(s: SourceMap): Promise<SourceMap> {
    return this.store.put(COLLECTIONS.sourceMaps, s);
  }
  getSourceMap(id: string): Promise<SourceMap | null> {
    return this.store.get<SourceMap>(COLLECTIONS.sourceMaps, id);
  }
}
