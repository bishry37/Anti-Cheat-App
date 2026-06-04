import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, doc, updateDoc, onSnapshot, getDocs, addDoc, deleteDoc } from 'firebase/firestore';
import { StudentSession, Violation, Exam, Subject } from '../../types';
import { Loader2, AlertTriangle, Eye, ShieldAlert, MonitorOff, Activity, BadgeAlert, X, Trash2 } from 'lucide-react';

export default function ExamMonitor() {
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [exams, setExams] = useState<Record<string, Exam>>({});
  const [subjects, setSubjects] = useState<Record<string, Subject>>({});
  const [loading, setLoading] = useState(true);

  // Detail Modal
  const [selectedSession, setSelectedSession] = useState<StudentSession | null>(null);
  const [sessionViolations, setSessionViolations] = useState<Violation[]>([]);

  // Toast Notification state
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  // Custom Confirmation Dialog Modal state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'warning' | 'end_exam' | 'delete';
    candidateId?: string;
    candidateName: string;
    session?: StudentSession;
  }>({
    isOpen: false,
    type: 'warning',
    candidateName: ''
  });

  useEffect(() => {
    // Fetch static references first
    const fetchRefs = async () => {
      try {
        const [exSnap, subSnap] = await Promise.all([
          getDocs(collection(db, 'exams')),
          getDocs(collection(db, 'subjects'))
        ]);
        
        const exMap: Record<string, Exam> = {};
        exSnap.forEach(d => exMap[d.id] = d.data() as Exam);
        setExams(exMap);

        const subMap: Record<string, Subject> = {};
        subSnap.forEach(d => subMap[d.id] = d.data() as Subject);
        setSubjects(subMap);
      } catch (err) {
        console.error(err);
      }
    };
    
    fetchRefs().then(() => {
      // Subscribe to active sessions
      const q = query(collection(db, 'student_sessions'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as StudentSession));
        // Sort active first, then newest
        data.sort((a, b) => {
          if (a.status === 'Aktif' && b.status !== 'Aktif') return -1;
          if (b.status === 'Aktif' && a.status !== 'Aktif') return 1;
          return b.startTime - a.startTime;
        });
        setSessions(data);
        setLoading(false);
        
        // Update selected session if open
        if (selectedSession) {
          const updated = data.find(s => s.id === selectedSession.id);
          if (updated) setSelectedSession(updated);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'student_sessions');
      });
      return () => unsubscribe();
    });
  }, []);

  const openMonitor = async (session: StudentSession) => {
    setSelectedSession(session);
    // Fetch violations for this session
    try {
      const vSnap = await getDocs(query(collection(db, 'violations')));
      const vols = vSnap.docs
        .map(d => d.data() as Violation)
        .filter(v => v.sessionId === session.id)
        .sort((a, b) => b.timestamp - a.timestamp);
      setSessionViolations(vols);
    } catch (e) { console.error(e); }
  };

  const triggerWarning = (session: StudentSession) => {
    setConfirmDialog({
      isOpen: true,
      type: 'warning',
      candidateName: session.studentName,
      session
    });
  };

  const triggerEndExam = (session: StudentSession) => {
    setConfirmDialog({
      isOpen: true,
      type: 'end_exam',
      candidateName: session.studentName,
      session
    });
  };

  const triggerDelete = (id: string, name: string) => {
    setConfirmDialog({
      isOpen: true,
      type: 'delete',
      candidateId: id,
      candidateName: name
    });
  };

  const executeConfirmedAction = async () => {
    const { type, session, candidateId } = confirmDialog;
    setConfirmDialog(prev => ({ ...prev, isOpen: false }));

    if (type === 'warning' && session) {
      const msg = "Perhatian! Sistem mendeteksi aktivitas yang tidak sesuai aturan ujian. Mohon tetap fokus dan mengerjakan ujian dengan jujur. Pelanggaran berikutnya dapat menyebabkan ujian dihentikan.";
      try {
        await addDoc(collection(db, 'violations'), {
          sessionId: session.id,
          studentName: session.studentName,
          subjectId: session.subjectId,
          type: 'Peringatan Admin',
          status: msg,
          timestamp: Date.now()
        });
        showToast('Peringatan terkirim');
        if (selectedSession?.id === session.id) openMonitor(session);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'violations');
      }
    } else if (type === 'end_exam' && session) {
      try {
        await updateDoc(doc(db, 'student_sessions', session.id!), {
          status: 'Didiskualifikasi',
          endTime: Date.now()
        });
        setSelectedSession(null);
        showToast('Ujian telah dihentikan paksa');
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, 'student_sessions');
      }
    } else if (type === 'delete' && candidateId) {
      try {
        await deleteDoc(doc(db, 'student_sessions', candidateId));
        showToast('Sesi ujian berhasil dihapus');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'student_sessions');
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'Aktif': return <span className="flex items-center gap-1.5 text-xs text-slate-700"><span className="w-2 h-2 rounded-full bg-green-500 shadow-sm"></span> Aktif</span>;
      case 'Tidak Fokus': return <span className="flex items-center gap-1.5 text-xs text-orange-500"><span className="w-2 h-2 rounded-full bg-orange-400"></span> Tidak Fokus</span>;
      case 'Melanggar': return <span className="flex items-center gap-1.5 text-xs text-red-600 font-bold"><span className="w-2 h-2 rounded-full bg-red-600"></span> MELANGGAR</span>;
      case 'Selesai': return <span className="flex items-center gap-1.5 text-xs text-blue-600"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Selesai</span>;
      case 'Didiskualifikasi': return <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-400"></span> Diskualifikasi</span>;
      default: return <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-300"></span> {status}</span>;
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;

  return (
    <div className="w-full flex flex-col h-full">
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col flex-1">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Real-time Student Monitoring</h3>
          <div className="flex gap-2">
            <div className="flex items-center text-[11px] text-slate-500 bg-slate-50 px-2 border border-slate-200 rounded">
               Total Peserta: {sessions.length}
            </div>
            <button className="text-[11px] bg-slate-100 px-3 py-1 rounded font-semibold text-slate-600 border border-transparent hover:border-slate-300">Filter Status</button>
          </div>
        </div>
        
        <div className="overflow-auto flex-1">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold border-b border-slate-100 sticky top-0 z-10">
                <th className="px-4 py-2 w-10">#</th>
                <th className="px-4 py-2">Siswa</th>
                <th className="px-4 py-2">Ujian / Mapel</th>
                <th className="px-4 py-2 text-center">Pelanggaran</th>
                <th className="px-4 py-2">Status Live</th>
                <th className="px-4 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                      <MonitorOff className="w-6 h-6 text-slate-400" />
                    </div>
                    Tidak ada peserta aktif saat ini.
                  </td>
                </tr>
              ) : (
                sessions.map((s, idx) => {
                  const isWarning = s.violationsCount > 0 && s.status === 'Aktif';
                  return (
                    <tr key={s.id} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${isWarning ? 'bg-orange-50/50' : ''} ${s.status === 'Melanggar' ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-3 text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{s.studentName}</div>
                        <div className="text-[10px] text-slate-500">Kelas {s.className}
                          {(Date.now() - s.lastActivity) > 60000 && s.status === 'Aktif' && (
                            <span className="ml-1 text-red-500 font-bold tracking-tight">/ OFFLINE</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                         <div className="font-medium text-slate-700">{exams[s.examId]?.title || 'Ujian'}</div>
                         <div className="text-[10px] text-slate-500">{subjects[s.subjectId]?.name || 'Mapel'}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {s.violationsCount > 0 ? (
                          <span className={`font-bold px-2 rounded ${s.violationsCount >= 3 ? 'text-red-600 bg-red-100 border border-red-200 animate-pulse' : 'text-orange-600 bg-orange-50 border border-orange-100'}`}>
                            {s.violationsCount}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-bold bg-slate-100 border border-slate-200 px-2 rounded">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(s.status)}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1 flex items-center justify-end">
                          <button onClick={() => openMonitor(s)} className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${s.status === 'Melanggar' || s.violationsCount > 0 ? 'bg-white text-slate-800 border border-slate-200' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>
                            Monitor
                          </button>
                          {s.status !== 'Selesai' && s.status !== 'Didiskualifikasi' ? (
                            <button onClick={() => triggerWarning(s)} className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${s.status === 'Melanggar' || s.violationsCount > 0 ? 'bg-red-600 text-white border border-red-700' : 'bg-slate-50 text-slate-400 border border-slate-200 hover:text-slate-600'}`}>
                              Tegur
                            </button>
                          ) : (
                            <button onClick={() => triggerDelete(s.id!, s.studentName)} className="px-2 py-1 rounded text-[10px] font-bold transition-colors bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 flex items-center gap-1" title="Hapus Sesi Selesai">
                              <Trash2 className="w-3 h-3" />
                              <span>Hapus</span>
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <div>Showing 1 - {sessions.length} students</div>
        </div>
      </div>

      {/* Modal Detail */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center">
                <Activity className="w-5 h-5 mr-2 text-blue-600" />
                Detail Monitoring: {selectedSession.studentName}
              </h3>
              <button onClick={() => setSelectedSession(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors">
                 <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 flex-1 overflow-y-auto w-full">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Status</p>
                  <div>{getStatusBadge(selectedSession.status)}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Pelanggaran</p>
                  <p className="text-lg font-bold text-red-600">{selectedSession.violationsCount}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 md:col-span-2">
                   <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-1">Aktivitas Terakhir</p>
                   <p className="text-sm font-medium text-slate-800">
                     {new Date(selectedSession.lastActivity).toLocaleTimeString()}
                     {Date.now() - selectedSession.lastActivity > 60000 ? ' (Kemungkinan Offline)' : ' (Online)'}
                   </p>
                </div>
              </div>

              <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center">
                <ShieldAlert className="w-4 h-4 mr-2" /> Log Pelanggaran & Aktivitas
              </h4>
              
              <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                {sessionViolations.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    Belum ada pelanggaran yang tercatat. Siswa teladan.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-200">
                    {sessionViolations.map((v, i) => (
                      <li key={i} className="p-4 flex items-start space-x-3 hover:bg-white transition-colors">
                        <div className="mt-0.5">
                          {v.type === 'Peringatan Admin' ? <AlertTriangle className="w-4 h-4 text-orange-500" /> : <BadgeAlert className="w-4 h-4 text-red-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-800 mb-0.5">{v.type}</p>
                          <p className="text-xs text-slate-500 mb-1">{new Date(v.timestamp).toLocaleTimeString()}</p>
                          {v.status && <p className="text-sm text-slate-600 bg-slate-100 p-2 rounded mt-1 border border-slate-200">{v.status}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end space-x-3">
              {selectedSession.status !== 'Selesai' && selectedSession.status !== 'Didiskualifikasi' && (
                <>
                  <button onClick={() => triggerWarning(selectedSession)} className="px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 font-medium rounded-lg transition-colors text-sm">
                    Kirim Peringatan
                  </button>
                  <button onClick={() => triggerEndExam(selectedSession)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors text-sm shadow-sm flex items-center">
                    <MonitorOff className="w-4 h-4 mr-2" /> Akhiri Ujian (Diskualifikasi)
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] bg-slate-900 border border-slate-800 text-white font-medium text-xs px-3.5 py-2.5 rounded-lg shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          <span>{toast}</span>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full border border-slate-100 p-5 flex flex-col items-center text-center animate-in scale-in duration-200">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${
              confirmDialog.type === 'delete' ? 'bg-red-50 text-red-600' :
              confirmDialog.type === 'end_exam' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
            }`}>
              {confirmDialog.type === 'delete' || confirmDialog.type === 'end_exam' ? (
                <ShieldAlert className="w-6 h-6" />
              ) : (
                <AlertTriangle className="w-6 h-6" />
              )}
            </div>
            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-1">
              {confirmDialog.type === 'delete' ? 'Hapus Sesi Ujian' :
               confirmDialog.type === 'end_exam' ? 'Akhiri Paksa Ujian' : 'Kirim Teguran'}
            </h4>
            <p className="text-xs text-slate-500 leading-relaxed mb-5">
              {confirmDialog.type === 'delete' && `Apakah Anda yakin ingin menghapus data sesi ujian untuk ${confirmDialog.candidateName}? Tindakan ini tidak dapat dibatalkan.`}
              {confirmDialog.type === 'end_exam' && `Apakah Anda yakin ingin mengakhiri paksa ujian untuk ${confirmDialog.candidateName}? Mereka akan didiskualifikasi.`}
              {confirmDialog.type === 'warning' && `Kirim peringatan/teguran kedisiplinan ke siswa ${confirmDialog.candidateName}?`}
            </p>
            <div className="flex gap-2 w-full">
              <button 
                onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))} 
                className="flex-1 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Batal
              </button>
              <button 
                onClick={executeConfirmedAction} 
                className={`flex-1 px-3 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors ${
                  confirmDialog.type === 'delete' || confirmDialog.type === 'end_exam' 
                    ? 'bg-red-600 hover:bg-red-700' 
                    : 'bg-amber-500 hover:bg-amber-600'
                }`}
              >
                {confirmDialog.type === 'delete' ? 'Hapus' :
                 confirmDialog.type === 'end_exam' ? 'Akhiri' : 'Kirim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
