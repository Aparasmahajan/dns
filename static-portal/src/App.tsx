import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import { isAdmin } from './format';
import AuditPage from './pages/Audit';
import Dashboard from './pages/Dashboard';
import DemoPage from './pages/Demo';
import GroupsPage from './pages/Groups';
import LoginPage from './pages/Login';
import { AccountPasswordPage, ForcedPasswordChange } from './pages/Password';
import PendingAccess from './pages/Pending';
import RecordsPage from './pages/Records';
import RequestsPage from './pages/Requests';
import UsersPage from './pages/Users';

export default function App() {
  const { me, loading } = useAuth();

  if (loading) return <Loading text="Starting portal…" />;
  if (!me) return <LoginPage />;
  if (me.mustChangePassword) return <ForcedPasswordChange />;
  if (me.status === 'PENDING' || me.level === 'NONE') return <PendingAccess />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        {isAdmin(me) && <Route path="/users" element={<UsersPage />} />}
        {isAdmin(me) && <Route path="/audit" element={<AuditPage />} />}
        {isAdmin(me) && <Route path="/demo" element={<DemoPage />} />}
        <Route path="/account/password" element={<AccountPasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
