import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchAdminOverview,
  fetchAdminUsers,
  createAdminUser,
  updateUserStatus,
  updateUserRole,
  resetUserPassword,
  fetchAdminAuditLogs,
  fetchAdminSensors,
  registerAdminSensor,
  deleteAdminSensor,
  fetchDataSources
} from '../services/api';

export default function AdminPortal({ currentUser, authToken, onNavigate, onLogout }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ text: '', isError: false });

  const [overviewData, setOverviewData] = useState(null);
  const [users, setUsers] = useState([]);
  const [sensors, setSensors] = useState([]);
  const [dataSources, setDataSources] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    display_name: '',
    email: '',
    role: 'RESEARCHER',
    clearance: 'SCIENTIFIC',
    organization: 'MoES / INCOIS'
  });

  const [newSensor, setNewSensor] = useState({
    platform_id: '',
    name: '',
    platform_type: 'argo',
    latitude: 10.5,
    longitude: 75.2,
    max_depth: 2000,
    organization: 'MoES / INCOIS'
  });

  const [resettingUserId, setResettingUserId] = useState(null);
  const [newPasswordVal, setNewPasswordVal] = useState('');

  const loadOverview = useCallback(async () => {
    if (!authToken) return;
    try {
      const data = await fetchAdminOverview(authToken);
      setOverviewData(data);
    } catch (err) {
      console.warn('Overview fetch note:', err.message);
    }
  }, [authToken]);

  const loadUsers = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    try {
      const data = await fetchAdminUsers(authToken);
      setUsers(data?.users || []);
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to fetch users', isError: true });
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  const loadSensors = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    try {
      const data = await fetchAdminSensors(authToken);
      setSensors(data?.sensors || []);
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to fetch sensors', isError: true });
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  const loadDataSources = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    try {
      const data = await fetchDataSources(authToken);
      setDataSources(data?.data_sources || []);
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to fetch data sources', isError: true });
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  const loadAuditLogs = useCallback(async () => {
    if (!authToken) return;
    setLoading(true);
    try {
      const data = await fetchAdminAuditLogs(authToken, 100);
      setAuditLogs(data?.logs || []);
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to fetch audit logs', isError: true });
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    if (!authToken || currentUser?.role !== 'ADMIN') return;
    let ignore = false;
    void Promise.resolve().then(() => {
      if (ignore) return;
      loadOverview();
      if (activeTab === 'users') loadUsers();
      if (activeTab === 'sensors') loadSensors();
      if (activeTab === 'data_sources') loadDataSources();
      if (activeTab === 'audit_logs') loadAuditLogs();
    });
    return () => {
      ignore = true;
    };
  }, [activeTab, authToken, currentUser, loadOverview, loadUsers, loadSensors, loadDataSources, loadAuditLogs]);

  if (!authToken || !currentUser) {
    return (
      <div className="admin-denied-container" style={{ minHeight: '100vh', backgroundColor: '#080e18', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '440px', width: '100%', backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '28px', textAlign: 'center' }}>
          <span style={{ fontSize: '36px', display: 'block', marginBottom: '12px' }}>🔒</span>
          <h2 style={{ fontSize: '18px', margin: '0 0 8px 0', color: '#f8fafc' }}>Authentication Required</h2>
          <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5, marginBottom: '20px' }}>
            The SAMUDRA-3D Administration Portal is restricted to authorized MoES / INCOIS administrators.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button type="button" onClick={() => onNavigate?.('/login')} style={{ padding: '8px 16px', backgroundColor: '#0284c7', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              Sign In to Portal
            </button>
            <button type="button" onClick={() => onNavigate?.('/app')} style={{ padding: '8px 16px', backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '6px', color: '#cbd5e1', fontSize: '13px', cursor: 'pointer' }}>
              Return to Ocean Map
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (currentUser.role !== 'ADMIN') {
    return (
      <div className="admin-forbidden-container" style={{ minHeight: '100vh', backgroundColor: '#080e18', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '460px', width: '100%', backgroundColor: '#0f172a', border: '1px solid #ef4444', borderRadius: '8px', padding: '28px', textAlign: 'center' }}>
          <span style={{ fontSize: '36px', display: 'block', marginBottom: '12px' }}>🚫</span>
          <h2 style={{ fontSize: '18px', margin: '0 0 8px 0', color: '#f87171' }}>Access Forbidden</h2>
          <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: 1.5, marginBottom: '16px' }}>
            Your account ({currentUser.display_name}) has role <strong>{currentUser.role}</strong>. Administrative privileges are required.
          </p>
          <button type="button" onClick={() => onNavigate?.('/app')} style={{ padding: '8px 16px', backgroundColor: '#0284c7', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            Return to Ocean Map
          </button>
        </div>
      </div>
    );
  }

  const handleToggleUserStatus = async (user) => {
    try {
      const newStatus = !user.is_active;
      await updateUserStatus(user.user_id, newStatus, authToken);
      setStatusMsg({ text: `User ${user.username} is now ${newStatus ? 'Active' : 'Disabled'}.`, isError: false });
      loadUsers();
      loadOverview();
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to update user status.', isError: true });
    }
  };

  const handleChangeRole = async (user, newRole) => {
    try {
      await updateUserRole(user.user_id, newRole, authToken);
      setStatusMsg({ text: `Role for ${user.username} updated to ${newRole}.`, isError: false });
      loadUsers();
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to update user role.', isError: true });
    }
  };

  const handleResetPassword = async (userId) => {
    if (!newPasswordVal.trim()) {
      setStatusMsg({ text: 'Please enter a valid new password.', isError: true });
      return;
    }
    try {
      await resetUserPassword(userId, newPasswordVal.trim(), authToken);
      setStatusMsg({ text: 'Password reset successfully.', isError: false });
      setResettingUserId(null);
      setNewPasswordVal('');
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to reset password.', isError: true });
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.password.trim() || !newUser.display_name.trim()) {
      setStatusMsg({ text: 'Username, password, and full name are required.', isError: true });
      return;
    }
    try {
      await createAdminUser(newUser, authToken);
      setStatusMsg({ text: `User ${newUser.username} created successfully!`, isError: false });
      setNewUser({
        username: '',
        password: '',
        display_name: '',
        email: '',
        role: 'RESEARCHER',
        clearance: 'SCIENTIFIC',
        organization: 'MoES / INCOIS'
      });
      loadUsers();
      loadOverview();
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to create user.', isError: true });
    }
  };

  const handleRegisterSensor = async (e) => {
    e.preventDefault();
    if (!newSensor.platform_id.trim() || !newSensor.name.trim()) {
      setStatusMsg({ text: 'Platform ID and Name are required.', isError: true });
      return;
    }
    try {
      await registerAdminSensor({
        platform_id: newSensor.platform_id.trim(),
        name: newSensor.name.trim(),
        platform_type: newSensor.platform_type,
        latitude: parseFloat(newSensor.latitude),
        longitude: parseFloat(newSensor.longitude),
        max_depth: parseFloat(newSensor.max_depth),
        organization: newSensor.organization.trim()
      }, authToken);
      setStatusMsg({ text: `Sensor platform ${newSensor.platform_id} registered into fleet.`, isError: false });
      setNewSensor({
        platform_id: '',
        name: '',
        platform_type: 'argo',
        latitude: 10.5,
        longitude: 75.2,
        max_depth: 2000,
        organization: 'MoES / INCOIS'
      });
      loadSensors();
      loadOverview();
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to register sensor.', isError: true });
    }
  };

  const handleDeleteSensor = async (sensorId) => {
    if (!window.confirm(`Are you sure you want to decommission platform ${sensorId}?`)) return;
    try {
      await deleteAdminSensor(sensorId, authToken);
      setStatusMsg({ text: `Sensor platform ${sensorId} decommissioned.`, isError: false });
      loadSensors();
      loadOverview();
    } catch (err) {
      setStatusMsg({ text: err.message || 'Failed to decommission sensor.', isError: true });
    }
  };

  return (
    <div className="admin-portal-wrapper" data-testid="admin-portal" style={{ minHeight: '100vh', backgroundColor: '#080e18', color: '#f8fafc', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button
            type="button"
            data-testid="admin-back-btn"
            onClick={() => onNavigate?.('/app')}
            style={{ padding: '6px 12px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: '#38bdf8', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>←</span>
            <span>Ocean Workspace</span>
          </button>
          <div>
            <h1 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>SAMUDRA-3D</span>
              <span style={{ fontSize: '11px', fontWeight: 600, backgroundColor: '#0284c7', color: '#fff', padding: '2px 8px', borderRadius: '4px' }}>ADMINISTRATION</span>
            </h1>
            <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>MoES / INCOIS Security Registry & Platform Governance</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc', display: 'block' }}>{currentUser.display_name}</span>
            <span style={{ fontSize: '11px', color: '#38bdf8' }}>{currentUser.role} · {currentUser.organization}</span>
          </div>
          <button
            type="button"
            data-testid="admin-signout-btn"
            onClick={onLogout}
            style={{ padding: '6px 12px', backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '6px', color: '#f87171', fontSize: '12px', cursor: 'pointer' }}
          >
            Sign Out
          </button>
        </div>
      </header>

      <nav style={{ backgroundColor: '#0b1329', borderBottom: '1px solid #1e293b', padding: '0 28px', display: 'flex', gap: '8px', overflowX: 'auto' }}>
        {[
          { id: 'overview', label: 'Overview & Status' },
          { id: 'users', label: `Users & Access (${users.length || overviewData?.stats?.total_users || 0})` },
          { id: 'sensors', label: `Sensors & Fleet (${sensors.length || overviewData?.stats?.total_sensors || 0})` },
          { id: 'data_sources', label: 'Data Sources' },
          { id: 'audit_logs', label: 'Security Audit Log' }
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`admin-tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 16px',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #38bdf8' : '2px solid transparent',
              color: activeTab === tab.id ? '#38bdf8' : '#94a3b8',
              fontWeight: activeTab === tab.id ? 600 : 400,
              fontSize: '13px',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {statusMsg.text && (
        <div
          role="status"
          style={{
            margin: '16px 28px 0 28px',
            padding: '10px 14px',
            borderRadius: '6px',
            backgroundColor: statusMsg.isError ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
            border: `1px solid ${statusMsg.isError ? '#ef4444' : '#10b981'}`,
            color: statusMsg.isError ? '#fca5a5' : '#6ee7b7',
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>{statusMsg.text}</span>
          <button type="button" onClick={() => setStatusMsg({ text: '', isError: false })} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '13px' }} title="Dismiss notification">
            ✕
          </button>
        </div>
      )}

      <main style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>
        {activeTab === 'overview' && (
          <div data-testid="tab-panel-overview" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Platform State</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#34d399', marginTop: '6px' }}>OPERATIONAL</div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>FastAPI + 3D WebGL Engine</span>
              </div>
              <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Personnel Accounts</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#38bdf8', marginTop: '6px' }}>
                  {overviewData?.stats?.total_users ?? users.length ?? '...'} Active
                </div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>SQLite Authenticated Users</span>
              </div>
              <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Registered Platforms</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#f59e0b', marginTop: '6px' }}>
                  {overviewData?.stats?.total_sensors ?? sensors.length ?? '...'} Platforms
                </div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>Argo, Gliders, Moored Buoys</span>
              </div>
              <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '16px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data Sources</span>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#a855f7', marginTop: '6px' }} data-testid="admin-data-sources-stat">
                  {overviewData?.stats?.total_data_sources ?? overviewData?.data_sources_count ?? '3'} Catalogued
                </div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>ROMS Model, Argo DAC, Seagliders (ERDDAP Offline)</span>
              </div>
            </div>

            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '20px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>Quick Administrative Actions</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <button type="button" onClick={() => setActiveTab('users')} style={{ padding: '8px 14px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: '#f8fafc', fontSize: '12px', cursor: 'pointer' }}>
                  Manage Officer Accounts →
                </button>
                <button type="button" onClick={() => setActiveTab('sensors')} style={{ padding: '8px 14px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: '#f8fafc', fontSize: '12px', cursor: 'pointer' }}>
                  Deploy / Decommission Sensors →
                </button>
                <button type="button" onClick={() => setActiveTab('audit_logs')} style={{ padding: '8px 14px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: '#f8fafc', fontSize: '12px', cursor: 'pointer' }}>
                  Inspect Audit Logs →
                </button>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'users' && (
          <div data-testid="tab-panel-users" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '20px' }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                Register New Authorized Personnel
              </h3>
              <form onSubmit={handleCreateUser} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Commander Rajesh Sharma"
                    value={newUser.display_name}
                    onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Username *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. r.sharma"
                    value={newUser.username}
                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Password *</label>
                  <input
                    type="password"
                    required
                    placeholder="Secure password"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Role</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => {
                      const r = e.target.value;
                      const c = r === 'ADMIN' ? 'ADMINISTRATOR' : r === 'OPERATOR' ? 'OPERATIONAL' : r === 'RESEARCHER' ? 'SCIENTIFIC' : 'VIEW-ONLY';
                      setNewUser({ ...newUser, role: r, clearance: c });
                    }}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  >
                    <option value="ADMIN">ADMIN (System Administrator)</option>
                    <option value="OPERATOR">OPERATOR (Duty Forecaster / Operator)</option>
                    <option value="RESEARCHER">RESEARCHER (Marine Research Scientist)</option>
                    <option value="VIEWER">VIEWER (Public / Academic Observer)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Organization</label>
                  <input
                    type="text"
                    placeholder="MoES / INCOIS"
                    value={newUser.organization}
                    onChange={(e) => setNewUser({ ...newUser, organization: e.target.value })}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <button type="submit" style={{ width: '100%', padding: '8px 14px', backgroundColor: '#0284c7', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    + Register User
                  </button>
                </div>
              </form>
            </div>

            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>Authorized Personnel Registry</h3>
                <button type="button" onClick={loadUsers} disabled={loading} style={{ padding: '4px 10px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#cbd5e1', fontSize: '11px', cursor: 'pointer' }}>
                  ? Refresh
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#131e33', color: '#94a3b8', borderBottom: '1px solid #1e293b' }}>
                      <th style={{ padding: '10px 14px' }}>Officer</th>
                      <th style={{ padding: '10px 14px' }}>Username</th>
                      <th style={{ padding: '10px 14px' }}>Role</th>
                      <th style={{ padding: '10px 14px' }}>Status</th>
                      <th style={{ padding: '10px 14px' }}>Organization</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const isSelf = u.username === currentUser.username;
                      const isActive = u.is_active !== false && u.status !== 'disabled';
                      return (
                        <tr key={u.user_id} style={{ borderBottom: '1px solid #1e293b', backgroundColor: isSelf ? 'rgba(56, 189, 248, 0.05)' : 'transparent' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ fontWeight: 600, color: '#f8fafc' }}>{u.display_name}</div>
                            {isSelf && <span style={{ fontSize: '10px', color: '#38bdf8' }}>(You)</span>}
                          </td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#94a3b8' }}>{u.username}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <select
                              value={u.role}
                              disabled={isSelf}
                              onChange={(e) => handleChangeRole(u, e.target.value)}
                              style={{ padding: '3px 6px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '11px' }}
                            >
                              <option value="ADMIN">ADMIN</option>
                              <option value="OPERATOR">OPERATOR</option>
                              <option value="RESEARCHER">RESEARCHER</option>
                              <option value="VIEWER">VIEWER</option>
                            </select>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              backgroundColor: isActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: isActive ? '#34d399' : '#f87171',
                              border: `1px solid ${isActive ? '#10b981' : '#ef4444'}`
                            }}>
                              {isActive ? 'ACTIVE' : 'DISABLED'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{u.organization || 'MoES / INCOIS'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                              {!isSelf && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleUserStatus(u)}
                                  style={{ padding: '3px 8px', fontSize: '11px', backgroundColor: '#1e293b', border: `1px solid ${isActive ? '#ef4444' : '#10b981'}`, borderRadius: '4px', color: isActive ? '#f87171' : '#34d399', cursor: 'pointer' }}
                                >
                                  {isActive ? 'Disable' : 'Enable'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setResettingUserId(resettingUserId === u.user_id ? null : u.user_id);
                                  setNewPasswordVal('');
                                }}
                                style={{ padding: '3px 8px', fontSize: '11px', backgroundColor: '#1e293b', border: '1px solid #38bdf8', borderRadius: '4px', color: '#38bdf8', cursor: 'pointer' }}
                              >
                                Reset Pass
                              </button>
                            </div>
                            {resettingUserId === u.user_id && (
                              <div style={{ marginTop: '8px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                <input
                                  type="password"
                                  placeholder="New password"
                                  value={newPasswordVal}
                                  onChange={(e) => setNewPasswordVal(e.target.value)}
                                  style={{ padding: '3px 6px', fontSize: '11px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff' }}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleResetPassword(u.user_id)}
                                  style={{ padding: '3px 8px', fontSize: '11px', backgroundColor: '#0284c7', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}
                                >
                                  Save
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'sensors' && (
          <div data-testid="tab-panel-sensors" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '20px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
                Deploy / Register Ocean Sensor Platform
              </h3>
              <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#94a3b8' }}>
                Platforms without telemetric feeds display honest empty states (Pending Ingestion) instead of fabricated telemetry.
              </p>
              <form onSubmit={handleRegisterSensor} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Platform ID *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 2902999"
                    value={newSensor.platform_id}
                    onChange={(e) => setNewSensor({ ...newSensor, platform_id: e.target.value })}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Platform Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. INCOIS Bio-Argo 2902999"
                    value={newSensor.name}
                    onChange={(e) => setNewSensor({ ...newSensor, name: e.target.value })}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Platform Type</label>
                  <select
                    value={newSensor.platform_type}
                    onChange={(e) => setNewSensor({ ...newSensor, platform_type: e.target.value })}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  >
                    <option value="argo">Argo Profiling Float</option>
                    <option value="glider">Underwater Seaglider</option>
                    <option value="buoy">Moored Ocean Buoy</option>
                    <option value="drifter">Surface Drifter</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Latitude (?N)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newSensor.latitude}
                    onChange={(e) => setNewSensor({ ...newSensor, latitude: e.target.value })}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Longitude (?E)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newSensor.longitude}
                    onChange={(e) => setNewSensor({ ...newSensor, longitude: e.target.value })}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: '#080e18', border: '1px solid #334155', borderRadius: '4px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <button type="submit" style={{ width: '100%', padding: '8px 14px', backgroundColor: '#0284c7', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    + Deploy Platform
                  </button>
                </div>
              </form>
            </div>

            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>Active Sensor Fleet</h3>
                <button type="button" onClick={loadSensors} disabled={loading} style={{ padding: '4px 10px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#cbd5e1', fontSize: '11px', cursor: 'pointer' }}>
                  ? Refresh
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#131e33', color: '#94a3b8', borderBottom: '1px solid #1e293b' }}>
                      <th style={{ padding: '10px 14px' }}>Platform ID</th>
                      <th style={{ padding: '10px 14px' }}>Name</th>
                      <th style={{ padding: '10px 14px' }}>Type</th>
                      <th style={{ padding: '10px 14px' }}>Position</th>
                      <th style={{ padding: '10px 14px' }}>Status</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sensors.length === 0 ? (
                      <tr>
                        <td colSpan="6" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                          No registered sensor platforms found.
                        </td>
                      </tr>
                    ) : (
                      sensors.map((s) => (
                        <tr key={s.id || s.platform_id} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600, color: '#38bdf8' }}>
                            {s.platform_id || s.id}
                          </td>
                          <td style={{ padding: '10px 14px', color: '#f8fafc' }}>{s.name}</td>
                          <td style={{ padding: '10px 14px', textTransform: 'uppercase', color: '#94a3b8' }}>
                            {s.platform_type}
                          </td>
                          <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#cbd5e1' }}>
                            {s.latitude?.toFixed(2)}?N, {s.longitude?.toFixed(2)}?E
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontSize: '10px',
                              fontWeight: 600,
                              backgroundColor: s.has_observations === false ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                              color: s.has_observations === false ? '#fbbf24' : '#34d399',
                              border: `1px solid ${s.has_observations === false ? '#f59e0b' : '#10b981'}`
                            }}>
                              {s.has_observations === false ? 'PENDING INGESTION' : 'OPERATIONAL'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteSensor(s.id || s.platform_id)}
                              style={{ padding: '3px 8px', fontSize: '11px', backgroundColor: '#1e293b', border: '1px solid #ef4444', borderRadius: '4px', color: '#f87171', cursor: 'pointer' }}
                            >
                              Decommission
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'data_sources' && (
          <div data-testid="tab-panel-sources" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '18px' }}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>Official Oceanographic Data Pipelines</h3>
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                Operational numerical models and real-time observational networks providing assimilation into the Indian Ocean Twin.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
              {dataSources.map((ds) => (
                <div key={ds.id} style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>{ds.name}</h4>
                      <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid #10b981' }}>
                        {ds.status}
                      </span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#94a3b8', lineHeight: 1.5, margin: '0 0 14px 0' }}>{ds.description}</p>
                  </div>

                  <div style={{ borderTop: '1px solid #1e293b', paddingTop: '12px', fontSize: '11px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div><strong>Provider:</strong> <span style={{ color: '#cbd5e1' }}>{ds.provider}</span></div>
                    <div><strong>Update Cadence:</strong> <span style={{ color: '#cbd5e1' }}>{ds.update_frequency}</span></div>
                    <div><strong>Geographic Extent:</strong> <span style={{ color: '#cbd5e1' }}>{ds.spatial_coverage}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'audit_logs' && (
          <div data-testid="tab-panel-audit" style={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>Security & Operational Audit Trail</h3>
                <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>Tamper-evident chronological record of logins, role adjustments, and platform modifications.</p>
              </div>
              <button type="button" onClick={loadAuditLogs} disabled={loading} style={{ padding: '4px 10px', backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#cbd5e1', fontSize: '11px', cursor: 'pointer' }}>
                ? Refresh Logs
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: '#131e33', color: '#94a3b8', borderBottom: '1px solid #1e293b' }}>
                    <th style={{ padding: '9px 14px' }}>Timestamp (UTC)</th>
                    <th style={{ padding: '9px 14px' }}>Actor</th>
                    <th style={{ padding: '9px 14px' }}>Action</th>
                    <th style={{ padding: '9px 14px' }}>Target</th>
                    <th style={{ padding: '9px 14px' }}>Result / Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
                        No audit events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((log) => (
                      <tr key={log.log_id || log.id} style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '9px 14px', fontFamily: 'monospace', color: '#94a3b8' }}>
                          {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                        </td>
                        <td style={{ padding: '9px 14px', fontWeight: 600, color: '#38bdf8' }}>{log.actor}</td>
                        <td style={{ padding: '9px 14px' }}>
                          <span style={{ padding: '2px 6px', borderRadius: '3px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#f8fafc', fontWeight: 600 }}>
                            {log.action}
                          </span>
                        </td>
                        <td style={{ padding: '9px 14px', color: '#cbd5e1' }}>{log.target || '?'}</td>
                        <td style={{ padding: '9px 14px', color: '#94a3b8' }}>{log.result || log.details || 'OK'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
