/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Home from './pages/Home';
import AdminLayout from './components/layout/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import ExamMonitor from './pages/admin/ExamMonitor';
import ResultReport from './pages/admin/ResultReport';
import Settings from './pages/admin/Settings';
import Subjects from './pages/admin/Subjects';
import Exams from './pages/admin/Exams';
import QuestionBank from './pages/admin/QuestionBank';
import StudentExam from './pages/exam/StudentExam';

function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAdmin } = useAuth();
  if (!user || !isAdmin) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function ProtectedStudentRoute({ children }: { children: React.ReactNode }) {
  const { user, isAdmin } = useAuth();
  // Students are anonymous users
  if (!user || isAdmin) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          
          {/* Admin Routes wrapped in a Layout */}
          <Route path="/admin" element={<ProtectedAdminRoute><AdminLayout /></ProtectedAdminRoute>}>
            <Route index element={<AdminDashboard />} />
            <Route path="exams" element={<Exams />} />
            <Route path="questions" element={<QuestionBank />} />
            <Route path="subjects" element={<Subjects />} />
            <Route path="monitor" element={<ExamMonitor />} />
            <Route path="results" element={<ResultReport />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route path="/exam" element={<ProtectedStudentRoute><StudentExam /></ProtectedStudentRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
