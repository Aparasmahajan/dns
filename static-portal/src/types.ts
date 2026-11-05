export type AccessLevel = 'NONE' | 'READ' | 'WRITE' | 'CHECKER' | 'ADMIN';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'DISABLED';
export type UserSource = 'CONFIG' | 'LOCAL' | 'LDAP';
export type MappingType = 'SINGLE' | 'MULTI' | 'PTR';
export type RecordType = 'A' | 'PTR';
export type Operation = 'CREATE' | 'MODIFY' | 'DELETE' | 'ROLLBACK';
export type CrStatus = 'PENDING_APPROVAL' | 'SCHEDULED' | 'HELD' | 'APPLIED' | 'REJECTED' | 'CANCELLED' | 'FAILED';

export interface Ref {
  id: number;
  name: string;
}

export interface PublicConfig {
  portalName: string;
  orgName: string;
  siteName: string;
  siteRole: string;
  version: string;
  ldapEnabled: boolean;
  passwordMinLength: number;
  /** Departments to choose from (empty: free text). */
  departments: string[];
}

export interface Me {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  department: string | null;
  source: UserSource;
  level: AccessLevel;
  status: UserStatus;
  mustChangePassword: boolean;
  allGroups: boolean;
  groups: Ref[];
}

export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface RecordSpec {
  mappingType: MappingType;
  domain: string;
  ips: string[];
  ttl: number;
}

export interface PendingRef {
  id: number;
  number: string;
  operation: Operation;
}

export interface ScheduledRef {
  id: number;
  number: string;
  operation: Operation;
  status: CrStatus;
  scheduledAt: string | null;
}

export interface DnsRecord {
  id: number;
  group: Ref;
  recordType: RecordType;
  mappingType: MappingType;
  key: string;
  domain: string;
  ips: string[];
  ptrName: string | null;
  ttl: number;
  version: string;
  status: 'ACTIVE' | 'DELETED';
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  pending: PendingRef | null;
  scheduled: ScheduledRef | null;
  canChange: boolean;
  canRollback: boolean;
}

export interface Snapshot {
  recordType?: RecordType;
  mappingType?: MappingType;
  domain?: string;
  ips?: string[];
  ttl?: number;
  ptrName?: string | null;
  group?: string;
  version?: string;
  status?: string;
}

export interface RecordVersion {
  version: string;
  deleted: boolean;
  createdAt: string;
  createdBy: string | null;
  changeRequestId: number | null;
  changeRequestNumber: string | null;
  operation: Operation | null;
  restoredFrom: string | null;
  snapshot: Snapshot;
}

export interface LiveCheck {
  status: 'MATCH' | 'DRIFT' | 'NOT_CHECKED';
  message: string;
}

export interface RollbackPreview {
  recordId: number;
  recordKey: string;
  recordStatus: 'ACTIVE' | 'DELETED';
  currentVersion: string;
  targetVersion: string;
  resultVersion: string;
  current: Snapshot;
  target: Snapshot;
  live: LiveCheck;
  blocker: string | null;
}

export interface RecordDetail {
  record: DnsRecord;
  versions: RecordVersion[];
}

export interface UserRef {
  id: number;
  username: string;
  displayName: string | null;
}

export interface SiteResult {
  site: string;
  success: boolean;
  code?: number;
  message?: string;
}

export interface ChangeRequest {
  id: number;
  number: string;
  operation: Operation;
  status: CrStatus;
  direct: boolean;
  group: Ref;
  recordId: number | null;
  recordType: RecordType;
  recordKey: string;
  baseVersion: string | null;
  targetVersion: string | null;
  proposed: Snapshot | null;
  previous: Snapshot | null;
  reason: string;
  itsmRef: string | null;
  scheduledAt: string | null;
  maker: UserRef;
  createdAt: string;
  updatedAt: string;
  decidedBy: UserRef | null;
  decidedAt: string | null;
  decisionComment: string | null;
  executedAt: string | null;
  executionResult: SiteResult[] | null;
  errorMessage: string | null;
  resultVersion: string | null;
  canApprove: boolean;
  canEdit: boolean;
  canCancel: boolean;
  canConfirm: boolean;
}

export interface Group {
  id: number;
  name: string;
  description: string | null;
  recordCount: number;
  writerCount: number;
  createdAt: string;
  createdBy: string | null;
}

export interface UserRow {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  department: string | null;
  source: UserSource;
  level: AccessLevel;
  status: UserStatus;
  locked: boolean;
  lockedUntil: string | null;
  mustChangePassword: boolean;
  allGroups: boolean;
  groups: Ref[];
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
  managedByConfig: boolean;
  /** Latest access request (only filled for users waiting for access). */
  accessRequest: AccessRequest | null;
}

export interface AccessRequest {
  id: number;
  department: string;
  requestedLevel: AccessLevel;
  requestedGroups: Ref[];
  reason: string;
  status: 'OPEN' | 'GRANTED' | 'DECLINED';
  createdAt: string;
  updatedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
}

export interface PartitionOption {
  id: number;
  name: string;
  description: string | null;
}

/** What a user waiting for access sees: their latest request and the partitions they can ask for. */
export interface MyAccessRequest {
  request: AccessRequest | null;
  partitions: PartitionOption[];
}

/** Result of looking a user ID up in the Bank directory. */
export interface DirectoryEntry {
  username: string;
  found: boolean;
  displayName: string | null;
  email: string | null;
  department: string | null;
  existing: UserRow | null;
}

export interface UserWithPassword {
  user: UserRow;
  temporaryPassword: string;
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string | null;
  action: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  clientIp: string | null;
  site: string | null;
}

export interface HealthItem {
  name: string;
  detail: string;
  status: 'UP' | 'DOWN' | 'MOCK' | 'DISABLED' | 'INFO' | 'RUNNING' | 'STANDBY';
}

export interface GroupCount {
  id: number;
  name: string;
  count: number;
}

export interface Dashboard {
  days: number;
  totalRecords: number;
  addedInPeriod: number;
  awaitingApproval: number | null;
  myPending: number;
  appliedInPeriod: number;
  failedInPeriod: number;
  scheduled: number;
  held: number | null;
  pendingUsers: number | null;
  groupCount: number;
  perGroup: GroupCount[];
  recent: ChangeRequest[];
  health: HealthItem[];
}

export interface Counters {
  awaitingApproval: number | null;
  myPending: number;
  scheduled: number;
  held: number | null;
  pendingUsers: number | null;
}
