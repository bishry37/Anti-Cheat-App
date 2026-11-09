/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { createHashRouter, RouterProvider, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Home from './pages/Home';
import AdminLayout from './components/layout/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import ExamMonitor from './pages/admin/ExamMonitor';
import ResultReport from './pages/admin/ResultReport';
import Settings from './pages/admin/Settings';
import Subjects from './pages/admin/Subjects';
import Classes from './pages/admin/Classes';
import Exams from './pages/admin/Exams';
import QuestionBank from './pages/admin/QuestionBank';
import AudioBank from './pages/admin/AudioBank';
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

  if (!user || isAdmin) {
    return <Navigate to="/" replace />;
  }
  return children;
}

const router = createHashRouter([
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/admin",
    element: <ProtectedAdminRoute><AdminLayout /></ProtectedAdminRoute>,
    children: [
      {
        index: true,
        element: <AdminDashboard />,
      },
      {
        path: "exams",
        element: <Exams />,
      },
      {
        path: "questions",
        element: <QuestionBank />,
      },
      {
        path: "subjects",
        element: <Subjects />,
      },
      {
        path: "audio",
        element: <AudioBank />,
      },
      {
        path: "classes",
        element: <Classes />,
      },
      {
        path: "monitor",
        element: <ExamMonitor />,
      },
      {
        path: "results",
        element: <ResultReport />,
      },
      {
        path: "settings",
        element: <Settings />,
      },
    ],
  },
  {
    path: "/exam",
    element: <ProtectedStudentRoute><StudentExam /></ProtectedStudentRoute>,
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
