import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Bids from './pages/Bids';
import Inventory from './pages/Inventory';
import Accounts from './pages/Accounts';
import Invoices from './pages/Invoices';
import CustomerRisk from './pages/CustomerRisk';
import Disputes from './pages/Disputes';
import Treasury from './pages/Treasury';
import ActionLog from './pages/ActionLog';
import PolicyEditor from './pages/PolicyEditor';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => sessionStorage.getItem('iris_logged_in') === 'true');

  function handleLogin() {
    sessionStorage.setItem('iris_logged_in', 'true');
    setLoggedIn(true);
  }

  function handleLogout() {
    sessionStorage.removeItem('iris_logged_in');
    setLoggedIn(false);
  }

  if (!loggedIn) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout onLogout={handleLogout} />}>
          <Route index element={<Dashboard />} />
          <Route path="bids" element={<Bids />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="accounts/:buyerId" element={<Accounts />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="customers" element={<CustomerRisk />} />
          <Route path="disputes" element={<Disputes />} />
          <Route path="treasury" element={<Treasury />} />
          <Route path="action-log" element={<ActionLog />} />
          <Route path="policies" element={<PolicyEditor />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
