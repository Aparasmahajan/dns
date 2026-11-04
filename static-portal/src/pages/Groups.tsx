import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useMe } from '../auth';
import { useToast } from '../components/Toast';
import { Empty, Loading, Modal } from '../components/ui';
import { fmtDateTime, isAdmin } from '../format';
import type { Group } from '../types';

/** Same rule as the F5 BIG-IP partition name (checked again on the server). */
const PARTITION_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function GroupModal({ group, onClose, onSaved }: { group: Group | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!PARTITION_RE.test(name.trim())) {
      setError('Use the F5 partition name: start with a letter; letters, digits, _ - or . only; no spaces; up to 64 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (group) await api.put(`/api/admin/groups/${group.id}`, { name, description });
      else await api.post('/api/admin/groups', { name, description });
      toast.success(group ? 'Partition updated.' : `Partition “${name.trim()}” created.`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={group ? `Edit ${group.name}` : 'New partition'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form="group-form" disabled={busy}>
            {busy ? 'Saving…' : group ? 'Save' : 'Create partition'}
          </button>
        </>
      }
    >
      <form id="group-form" onSubmit={submit} noValidate>
        {error && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <AlertTriangle size={17} /> <span>{error}</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="g-name">F5 partition name</label>
          <input id="g-name" className="input mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Internet_Banking" autoFocus />
          <span className="hint">
            Exactly as the partition is named on the F5 load balancer (no spaces). Every DNS record belongs to one partition, and Write users only
            work in the partitions you give them.
          </span>
        </div>
        <div className="field">
          <label htmlFor="g-desc">Description (optional)</label>
          <textarea id="g-desc" className="textarea" placeholder="e.g. Internet and mobile banking front ends" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}

export default function GroupsPage() {
  const me = useMe();
  const toast = useToast();
  const admin = isAdmin(me);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api
      .get<Group[]>('/api/groups')
      .then(setGroups)
      .catch((e) => toast.error(errorMessage(e)));
  }, [reload, toast]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api.del(`/api/admin/groups/${deleting.id}`);
      toast.success(`Partition “${deleting.name}” deleted.`);
      setDeleting(null);
      setReload((x) => x + 1);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="crumb">DNS</div>
          <h1>Partitions</h1>
          <div className="sub">
            {admin
              ? 'F5 partitions own the DNS records. You create and maintain them here, and Write users only see and change the partitions you assign to them.'
              : me.allGroups
                ? 'All F5 partitions. Only the Admin can create or change partitions.'
                : 'The F5 partitions assigned to you.'}
          </div>
        </div>
        {admin && (
          <div className="page-actions">
            <button className="btn btn-primary" onClick={() => setEditing('new')} style={{ height: 42 }}>
              <Plus size={17} /> New partition
            </button>
          </div>
        )}
      </div>

      <div className="card">
        {!groups ? (
          <Loading />
        ) : groups.length === 0 ? (
          <Empty title="No partitions yet" icon={<FolderTree size={34} />}>
            {admin ? 'Create the first partition, then give users access to it.' : 'The Admin has not assigned any partitions to you yet.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Partition</th>
                  <th>Records</th>
                  <th>Write users</th>
                  <th>Created</th>
                  {admin && <th />}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <div className="cell-main mono">{g.name}</div>
                      {g.description && <div className="cell-sub">{g.description}</div>}
                    </td>
                    <td>
                      <Link to={`/records?groupId=${g.id}`}>{g.recordCount.toLocaleString('en-IN')}</Link>
                    </td>
                    <td>{g.writerCount}</td>
                    <td className="muted small">
                      {fmtDateTime(g.createdAt)}
                      {g.createdBy ? ` · ${g.createdBy}` : ''}
                    </td>
                    {admin && (
                      <td className="actions">
                        <button className="btn btn-ghost btn-icon" title="Edit" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
                          <Pencil size={16} />
                        </button>
                        <button className="btn btn-ghost btn-icon" title="Delete" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <GroupModal
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setReload((x) => x + 1);
          }}
        />
      )}
      {deleting && (
        <Modal
          title={`Delete ${deleting.name}?`}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="btn btn-danger-solid" onClick={confirmDelete}>
                Delete partition
              </button>
            </>
          }
        >
          <p style={{ marginBottom: 16 }}>
            Users assigned to this partition lose access to it. A partition that owns records or has change history cannot be deleted.
          </p>
        </Modal>
      )}
    </>
  );
}
