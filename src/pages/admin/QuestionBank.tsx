import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RichTextEditor } from '../../components/RichTextEditor';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, query, getDocs, deleteDoc, doc, orderBy, where, writeBatch, updateDoc, addDoc, getDoc } from 'firebase/firestore';
import { Question, Subject } from '../../types';
import { Edit2, Trash2, Loader2, X, Upload, Download, FileSpreadsheet, Search, Check, Plus, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../../contexts/AuthContext';
import { useBlocker } from 'react-router-dom';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, VerticalMergeType } from 'docx';
import * as mammoth from 'mammoth';
import { preprocessDocxMath } from '../../utils/docxMathPreprocessor';
import { formatHTML } from '../../utils/textFormat';
import { renderMathInContainers } from '../../utils/mathRenderer';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const stripSimpleHTML = (val: string | undefined | null): string => {
  if (!val) return '';
  let str = String(val).trim();
  if (!str) return '';

  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(str, 'text/html');

      // 1. Unroll KaTeX formulas to TeX representation
      const katexEls = doc.querySelectorAll('.katex');
      katexEls.forEach(el => {
        const annot = el.querySelector('annotation[encoding*="tex"]');
        const tex = annot ? (annot.textContent || '') : (el.textContent || '');
        el.replaceWith(doc.createTextNode(tex));
      });

      // 2. Unroll Quill formula spans to TeX representation
      const qlEls = doc.querySelectorAll('.ql-formula');
      qlEls.forEach(el => {
        const tex = el.getAttribute('data-value') || el.textContent || '';
        el.replaceWith(doc.createTextNode(tex));
      });

      // 3. If it has media/table elements, preserve HTML without p tags
      if (doc.querySelector('img, table, tr, td, audio, video, iframe, svg')) {
        let inner = doc.body.innerHTML.trim();
        inner = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '').trim();
        return inner;
      }

      // 4. If it has simple styling tags (bold, italic, underline, sub, sup)
      if (doc.querySelector('u, b, strong, i, em, s, strike, sub, sup, ins, font')) {
        let inner = doc.body.innerHTML.trim();
        inner = inner.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '').trim();
        return inner;
      }

      // 5. Otherwise return plain text content
      return (doc.body.textContent || doc.body.innerText || '').trim();
    } catch {
      // fallback
    }
  }

  // Fallback string replacement
  str = str.replace(/<span[^>]*class="[^"]*ql-formula[^"]*"[^>]*data-value="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi, '$1');
  str = str.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '').trim();
  if (/<(img|table|tr|td|audio|video|iframe|svg)/i.test(str)) {
    return str.trim();
  }
  return str.replace(/<[^>]*>/g, '').trim();
};

const isOptionEmpty = (val: string | undefined | null): boolean => {
  if (!val) return true;
  const str = String(val).trim();
  if (/<(img|audio|video|iframe|svg|math)/i.test(str)) {
    return false;
  }
  const plainText = str.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, '').trim();
  return plainText === '';
};

const togglePgkKey = (current: string | undefined, key: string) => {
  const selected = (current || '').split(',').map(s => s.trim()).filter(Boolean);
  let next: string[];
  if (selected.includes(key)) {
    next = selected.filter(k => k !== key);
  } else {
    next = [...selected, key].sort();
  }
  return next.join(',');
};

export default function QuestionBank() {
  const { user } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [originalQuestions, setOriginalQuestions] = useState<Question[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [existingTemplates, setExistingTemplates] = useState<string[]>([]);
  const [selectedTemplateFilter, setSelectedTemplateFilter] = useState<string | null>(null);
  const [searchTemplateQuery, setSearchTemplateQuery] = useState<string>('');
  const [searchQuestionQuery, setSearchQuestionQuery] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [editingData, setEditingData] = useState<Question | null>(null);
  const [originalEditingData, setOriginalEditingData] = useState<Question | null>(null);
  const [isAddingQuestion, setIsAddingQuestion] = useState(false);
  const isDirty = false;
  const setIsDirty = (_val: boolean) => {};

  const [hasEditedWeights, setHasEditedWeights] = useState<boolean>(false);

  useEffect(() => {
    if (selectedSubject && selectedTemplateFilter) {
      const key = `cbt_custom_weights_${selectedSubject}_${selectedTemplateFilter}`;
      try {
        const saved = localStorage.getItem(key) === 'true';
        setHasEditedWeights(saved);
      } catch {
        setHasEditedWeights(false);
      }
    } else {
      setHasEditedWeights(false);
    }
  }, [selectedSubject, selectedTemplateFilter]);

  const totalWeight = useMemo(() => {
    if (!questions || questions.length === 0) return 0;
    return questions.reduce((acc, q) => acc + (Number(q.weight) || 0), 0);
  }, [questions]);

  const isWeight100 = Math.abs(totalWeight - 100) < 0.05;
  const weightDiff = Number((100 - totalWeight).toFixed(2));

  const isEditingChanged = () => {
    if (!editingData || !originalEditingData) return false;
    return JSON.stringify(editingData) !== JSON.stringify(originalEditingData);
  };
  const [addingData, setAddingData] = useState<Partial<Question>>({
    number: 1,
    question: '',
    optionA: '',
    optionB: '',
    optionC: '',
    optionD: '',
    optionE: '',
    correctAnswer: 'A',
    weight: 1,
    type: 'pilihan_ganda'
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State for fully functional, custom sandboxed confirmation and alert dialogs
  const [modalConfig, setModalConfig] = useState<{
    type: 'confirm' | 'prompt' | 'alert' | 'delete-all' | null;
    title: string;
    description: string;
    inputValue?: string;
    placeholder?: string;
    validationWord?: string;
    confirmText?: string;
    onConfirm?: (val?: string) => void;
    onCancel?: () => void;
    isDanger?: boolean;
    isSuccess?: boolean;
  } | null>(null);

  const showCustomAlert = (title: string, description: string, isSuccess = false) => {
    setModalConfig({
      type: 'alert',
      title,
      description,
      confirmText: 'OK',
      isSuccess,
      isDanger: !isSuccess
    });
  };

  const showCustomConfirm = (
    title: string,
    description: string,
    onConfirm: () => void,
    isDanger = false,
    confirmText = 'Ya, Hapus'
  ) => {
    setModalConfig({
      type: 'confirm',
      title,
      description,
      onConfirm,
      isDanger,
      confirmText
    });
  };

  const showCustomPrompt = (
    title: string,
    description: string,
    defaultValue: string,
    placeholder: string,
    onConfirm: (val: string) => void
  ) => {
    setModalConfig({
      type: 'prompt',
      title,
      description,
      inputValue: defaultValue,
      placeholder,
      confirmText: 'Simpan',
      onConfirm: (val) => {
        if (val) onConfirm(val);
      }
    });
  };

  useEffect(() => {
    if (user) fetchSubjects();
  }, [user]);

  // Handle browser refresh/close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Block internal navigation
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (blocker.state === 'blocked') {
      showCustomConfirm(
        'Perubahan Belum Disimpan',
        'Anda memiliki perubahan yang belum disimpan. Silakan klik tombol "Simpan Perubahan" terlebih dahulu untuk memvalidasi bobot soal dan menyimpan progress Anda.',
        () => blocker.proceed(),
        false,
        'Tetap Pindah'
      );
      // We need to set onCancel specifically for the blocker
      setModalConfig(prev => prev ? {
        ...prev,
        onCancel: () => blocker.reset()
      } : null);
    }
  }, [blocker]);

  const fetchSubjects = async () => {
    try {
      const snap = await getDocs(collection(db, 'subjects'));
      const subs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Subject));
      subs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      setSubjects(subs);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (selectedSubject) {
      fetchQuestions();
      fetchExistingTemplates();
    } else {
      setQuestions([]);
      setExistingTemplates([]);
    }
  }, [selectedSubject, selectedTemplateFilter]);

  useEffect(() => {
    const render = () => {
      renderMathInContainers('.ql-editor');
    };
    render();
    const frameId = requestAnimationFrame(render);
    const timerId = setTimeout(render, 50);
    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
    };
  }, [questions, editingData, addingData, selectedTemplateFilter]);

  const fetchExistingTemplates = async () => {
    if (!selectedSubject) return;
    try {
      const q = query(collection(db, 'questions'), where('subjectId', '==', selectedSubject));
      const snap = await getDocs(q);
      const templates = new Set<string>();
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.packetName) templates.add(data.packetName);
      });
      setExistingTemplates(Array.from(templates).sort());
    } catch (e) {
      console.error(e);
    }
  };

  const autoAdjustWeights = async (subjectId: string, packetName: string, excludeId?: string) => {
    if (!subjectId || !packetName || packetName === 'all') return;
    try {
      const q = query(
        collection(db, 'questions'),
        where('subjectId', '==', subjectId),
        where('packetName', '==', packetName)
      );
      const snap = await getDocs(q);
      let docs = snap.docs;
      if (excludeId) {
        docs = docs.filter(d => d.id !== excludeId);
      }
      if (docs.length === 0) return;

      const questionsToUpdate = docs.map(d => {
        const data = d.data();
        return { id: d.id, type: data.type || 'pilihan_ganda' };
      });
      
      const typeUnits: Record<string, number> = { 
        'pilihan_ganda': 1, 
        'pilihan_ganda_kompleks': 2, 
        'listening': 5, 
        'essay': 10 
      };
      
      let totalUnits = 0;
      questionsToUpdate.forEach(q => {
        totalUnits += typeUnits[q.type] || 1;
      });

      if (totalUnits === 0) return;

      const unitValue = 100 / totalUnits;
      let currentWeightSum = 0;
      const batch = writeBatch(db);

      for (let idx = 0; idx < questionsToUpdate.length; idx++) {
        const qData = questionsToUpdate[idx];
        let qWeight = (typeUnits[qData.type] || 1) * unitValue;

        if (idx === questionsToUpdate.length - 1) {
          qWeight = Number((100 - currentWeightSum).toFixed(2));
        } else {
          qWeight = Number(qWeight.toFixed(2));
          currentWeightSum += qWeight;
        }

        batch.update(doc(db, 'questions', qData.id), { weight: qWeight });
      }

      await batch.commit();
    } catch (err) {
      console.error("Error auto adjusting weights:", err);
    }
  };

  const handleResetWeightsTo100 = async () => {
    if (!selectedSubject || !selectedTemplateFilter || selectedTemplateFilter === 'all') {
      showCustomAlert('Pilih Berkas Soal', 'Pilih salah satu berkas template soal untuk mereset bobot nilainya.', false);
      return;
    }
    showCustomConfirm(
      'Reset Bobot ke 100?',
      'Sistem akan otomatis menghitung dan membagikan bobot nilai ke seluruh soal dalam berkas ini secara proporsional sehingga total nilainya tepat 100.',
      async () => {
        setProcessing(true);
        try {
          await autoAdjustWeights(selectedSubject, selectedTemplateFilter);
          const key = `cbt_custom_weights_${selectedSubject}_${selectedTemplateFilter}`;
          try {
            localStorage.removeItem(key);
          } catch {}
          setHasEditedWeights(false);
          await fetchQuestions();
          showCustomAlert('Berhasil Reset', 'Bobot nilai seluruh soal berhasil direset ke standar sistem dan genap 100.', true);
        } catch (err) {
          console.error(err);
          showCustomAlert('Gagal Reset', 'Terjadi kesalahan saat mereset bobot soal.', false);
        } finally {
          setProcessing(false);
        }
      },
      false,
      'Reset Bobot Sekarang'
    );
  };

  const fetchQuestions = async () => {
    if (!selectedTemplateFilter) {
      setQuestions([]);
      return;
    }
    setLoading(true);
    try {
      let q;
      if (selectedTemplateFilter === 'all') {
        q = query(collection(db, 'questions'), where('subjectId', '==', selectedSubject));
      } else {
        q = query(collection(db, 'questions'), 
          where('subjectId', '==', selectedSubject), 
          where('packetName', '==', selectedTemplateFilter)
        );
      }
      const snap = await getDocs(q);
      const qs = snap.docs.map(d => {
        const data = d.data() as any;
        let qType = data.type;
        const tCode = data.typeCode;
        if (qType === 1 || qType === '1' || tCode === 1) {
          qType = 'pilihan_ganda';
        } else if (qType === 2 || qType === '2' || tCode === 2) {
          qType = 'listening';
        } else if (qType === 3 || qType === '3' || tCode === 3) {
          qType = 'essay';
        } else if (qType === 4 || qType === '4' || tCode === 4 || qType === 5 || qType === '5' || tCode === 5) {
          qType = 'pilihan_ganda_kompleks';
        } else if (!qType) {
          qType = 'pilihan_ganda';
        }
        return {
          id: d.id,
          ...data,
          type: qType,
          typeCode: tCode || (qType === 'pilihan_ganda_kompleks' ? 4 : qType === 'listening' ? 2 : qType === 'essay' ? 3 : 1)
        } as Question;
      });
      
      const typeOrder: Record<string, number> = { 'pilihan_ganda': 1, 'listening': 2, 'essay': 3, 'pilihan_ganda_kompleks': 4, 'isian_singkat': 5 };
      const sortedQs = qs.sort((a, b) => {
        const aType = a.type || 'pilihan_ganda';
        const bType = b.type || 'pilihan_ganda';
        if (typeOrder[aType] !== typeOrder[bType]) {
          return typeOrder[aType] - typeOrder[bType];
        }
        return (a.number || 0) - (b.number || 0);
      });
      
      setQuestions(sortedQs);
      setOriginalQuestions(sortedQs);

      // Verify and automatically balance weights to 100 on load if custom weights were not set
      if (selectedTemplateFilter !== 'all' && sortedQs.length > 0) {
        const totWeight = sortedQs.reduce((acc, curr) => acc + (Number(curr.weight) || 0), 0);
        const customWeightKey = `cbt_custom_weights_${selectedSubject}_${selectedTemplateFilter}`;
        let isCustom = false;
        try { isCustom = localStorage.getItem(customWeightKey) === 'true'; } catch {}
        if (!isCustom && Math.abs(totWeight - 100) >= 0.05) {
          autoAdjustWeights(selectedSubject, selectedTemplateFilter).then(() => {
            getDocs(q).then(newSnap => {
              const updatedQs = newSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) } as Question));
              updatedQs.sort((a, b) => (a.number || 0) - (b.number || 0));
              setQuestions(updatedQs);
              setOriginalQuestions(updatedQs);
            });
          });
        }
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleDownloadTemplate = async () => {
    try {
      const createCell = (text: string, bold: boolean = false, bgColor: string | undefined = undefined, widthPct: number | undefined = undefined, vMerge: any = undefined) => {
        return new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: text,
                  bold: bold,
                  size: 18,
                  color: bold ? "0f172a" : "334155"
                })
              ],
              spacing: { before: 80, after: 80 }
            })
          ],
          shading: bgColor ? { fill: bgColor } : undefined,
          width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
          verticalMerge: vMerge,
          margins: { top: 120, bottom: 120, left: 120, right: 120 },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
            left: { style: BorderStyle.SINGLE, size: 4, color: "cbd5e1" },
            right: { style: BorderStyle.SINGLE, size: 4, color: "cbd5e1" }
          }
        });
      };
      
      // Removed require('docx') because it's imported at the top

      // 1. INFO BOX TABLE (1 row, 1 cell, sits nicely boxed at the top)
      const infoBox = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                shading: { fill: "f8fafc" },
                margins: { top: 150, bottom: 150, left: 200, right: 200 },
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 12, color: "0284c7" },
                  bottom: { style: BorderStyle.SINGLE, size: 12, color: "0284c7" },
                  left: { style: BorderStyle.SINGLE, size: 12, color: "0284c7" },
                  right: { style: BorderStyle.SINGLE, size: 12, color: "0284c7" },
                },
                children: [
                  new Paragraph({
                    spacing: { before: 40, after: 40 },
                    children: [
                      new TextRun({
                        text: "INFORMASI UTAMA: KODE JENIS SOAL",
                        bold: true,
                        size: 20,
                        color: "0f172a"
                      })
                    ]
                  }),
                  new Paragraph({
                    spacing: { before: 20, after: 20 },
                    children: [
                      new TextRun({ text: "• Kode ", size: 18 }),
                      new TextRun({ text: "1", bold: true, size: 18, color: "0284c7" }),
                      new TextRun({ text: " : Untuk tipe soal ", size: 18 }),
                      new TextRun({ text: "Pilihan Ganda", bold: true, size: 18 })
                    ]
                  }),
                  new Paragraph({
                    spacing: { before: 20, after: 20 },
                    children: [
                      new TextRun({ text: "• Kode ", size: 18 }),
                      new TextRun({ text: "2", bold: true, size: 18, color: "0284c7" }),
                      new TextRun({ text: " : Untuk tipe soal ", size: 18 }),
                      new TextRun({ text: "Listening", bold: true, size: 18 })
                    ]
                  }),
                  new Paragraph({
                    spacing: { before: 20, after: 20 },
                    children: [
                      new TextRun({ text: "• Kode ", size: 18 }),
                      new TextRun({ text: "3", bold: true, size: 18, color: "7c3aed" }),
                      new TextRun({ text: " : Untuk tipe soal ", size: 18 }),
                      new TextRun({ text: "Essay (Kunci Jawaban sebagai acuan koreksi)", bold: true, size: 18 })
                    ]
                  }),
                  new Paragraph({
                    spacing: { before: 20, after: 20 },
                    children: [
                      new TextRun({ text: "• Kode ", size: 18 }),
                      new TextRun({ text: "4", bold: true, size: 18, color: "0d9488" }),
                      new TextRun({ text: " : Untuk tipe soal ", size: 18 }),
                      new TextRun({ text: "Pilihan Ganda Kompleks (Jawaban lebih dari satu, pisahkan dengan koma seperti A,C atau A,B,D)", bold: true, size: 18 })
                    ]
                  }),
                  new Paragraph({
                    spacing: { before: 20, after: 20 },
                    children: [
                      new TextRun({ text: "• Rumus Matematika: ", bold: true, size: 18, color: "059669" }),
                      new TextRun({ text: "Tuliskan langsung menggunakan Equation Editor Word (Insert > Equation / Alt +=) seperti pecahan, akar, pangkat, dll. Sistem otomatis mendeteksi dan merendernya dengan rapi ke siswa.", size: 18 })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      });

      // 2. Helper to generate MCQ / Listening question rows
      const createMcqQuestionRows = (
        noStr: string,
        soalText: string,
        jenisStr: string,
        options: { label: string; text: string }[],
        kunciStr: string
      ) => {
        const rows: TableRow[] = [];
        options.forEach((opt, idx) => {
          if (idx === 0) {
            rows.push(
              new TableRow({
                children: [
                  createCell(noStr, false, undefined, undefined, VerticalMergeType.RESTART),
                  createCell(soalText, false, undefined, undefined, VerticalMergeType.RESTART),
                  createCell(jenisStr, false, undefined, undefined, VerticalMergeType.RESTART),
                  createCell(opt.label, false),
                  createCell(opt.text, false),
                  createCell(kunciStr, false, undefined, undefined, VerticalMergeType.RESTART),
                ]
              })
            );
          } else {
            rows.push(
              new TableRow({
                children: [
                  createCell("", false, undefined, undefined, VerticalMergeType.CONTINUE),
                  createCell("", false, undefined, undefined, VerticalMergeType.CONTINUE),
                  createCell("", false, undefined, undefined, VerticalMergeType.CONTINUE),
                  createCell(opt.label, false),
                  createCell(opt.text, false),
                  createCell("", false, undefined, undefined, VerticalMergeType.CONTINUE),
                ]
              })
            );
          }
        });
        return rows;
      };

      // 3. PILIHAN GANDA TABLE (10 Questions)
      const mcqHeader = new TableRow({
        children: [
          createCell("NO", true, "e0f2fe", 6),
          createCell("SOAL", true, "e0f2fe", 42),
          createCell("JENIS", true, "e0f2fe", 8),
          createCell("OPSI", true, "e0f2fe", 6),
          createCell("JAWABAN", true, "e0f2fe", 32),
          createCell("KUNCI", true, "e0f2fe", 6),
        ]
      });

      const mcqRows: TableRow[] = [mcqHeader];
      // Question 1 (Sample)
      mcqRows.push(
        ...createMcqQuestionRows(
          "1",
          "Siapakah Presiden Indonesia pada tahun 1999?",
          "1",
          [
            { label: "A", text: "Soekarno" },
            { label: "B", text: "Soeharto" },
            { label: "C", text: "B. J. Habibie" },
            { label: "D", text: "Abdurrahman Wahid" },
            { label: "E", text: "Megawati Soekarnoputri" }
          ],
          "C"
        )
      );
      // Questions 2 - 10 (Blank slots)
      for (let i = 2; i <= 10; i++) {
        mcqRows.push(
          ...createMcqQuestionRows(
            String(i),
            "",
            "1",
            [
              { label: "A", text: "" },
              { label: "B", text: "" },
              { label: "C", text: "" },
              { label: "D", text: "" },
              { label: "E", text: "" }
            ],
            ""
          )
        );
      }

      const mcqTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: mcqRows
      });

      // 4. TABLE FOR LISTENING (10 Questions)
      const listeningHeader = new TableRow({
        children: [
          createCell("NO", true, "e0f2fe", 6),
          createCell("SOAL", true, "e0f2fe", 42),
          createCell("JENIS", true, "e0f2fe", 8),
          createCell("OPSI", true, "e0f2fe", 6),
          createCell("JAWABAN", true, "e0f2fe", 32),
          createCell("KUNCI", true, "e0f2fe", 6),
        ]
      });

      const listeningRows: TableRow[] = [listeningHeader];
      // Question 1 (Sample)
      listeningRows.push(
        ...createMcqQuestionRows(
          "1",
          "Pertanyaan audio listening: Manakah pernyataan yang sesuai dengan percakapan?",
          "2",
          [
            { label: "A", text: "Pilihan Jawaban A" },
            { label: "B", text: "Pilihan Jawaban B" },
            { label: "C", text: "Pilihan Jawaban C" },
            { label: "D", text: "Pilihan Jawaban D" },
            { label: "E", text: "Pilihan Jawaban E" }
          ],
          "A"
        )
      );
      // Questions 2 - 10 (Blank slots)
      for (let i = 2; i <= 10; i++) {
        listeningRows.push(
          ...createMcqQuestionRows(
            String(i),
            "",
            "2",
            [
              { label: "A", text: "" },
              { label: "B", text: "" },
              { label: "C", text: "" },
              { label: "D", text: "" },
              { label: "E", text: "" }
            ],
            ""
          )
        );
      }

      const listeningTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: listeningRows
      });

      // 3. ESSAY TABLE (10 Questions)
      const essayHeader = new TableRow({
        children: [
          createCell("NO", true, "f3e8ff", 6),
          createCell("SOAL", true, "f3e8ff", 58),
          createCell("JENIS", true, "f3e8ff", 8),
          createCell("KUNCI (PEDOMAN)", true, "f3e8ff", 28),
        ]
      });

      const essayRows: TableRow[] = [essayHeader];
      // Question 1 (Sample)
      essayRows.push(
        new TableRow({
          children: [
            createCell("1", false),
            createCell("Jelaskan pengertian ekologi laut dan berikan 2 contoh ekosistemnya!", false),
            createCell("3", false),
            createCell("Ekologi laut adalah studi hubungan organisme dengan lingkungan laut. Contoh: Terumbu karang dan Padang lamun.", false),
          ]
        })
      );
      // Questions 2 - 10 (Blank slots)
      for (let i = 2; i <= 10; i++) {
        essayRows.push(
          new TableRow({
            children: [
              createCell(String(i), false),
              createCell("", false),
              createCell("3", false),
              createCell("", false),
            ]
          })
        );
      }

      const essayTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: essayRows
      });

      // 6. PILIHAN GANDA KOMPLEKS TABLE (10 Questions - Kode 4)
      const pgkHeader = new TableRow({
        children: [
          createCell("NO", true, "ccfbf1", 6),
          createCell("SOAL", true, "ccfbf1", 42),
          createCell("JENIS", true, "ccfbf1", 8),
          createCell("OPSI", true, "ccfbf1", 6),
          createCell("JAWABAN", true, "ccfbf1", 32),
          createCell("KUNCI", true, "ccfbf1", 6),
        ]
      });

      const pgkRows: TableRow[] = [pgkHeader];
      // Question 1 (Sample PGK)
      pgkRows.push(
        ...createMcqQuestionRows(
          "1",
          "Manakah yang termasuk ke dalam organ pernapasan manusia? (Jawaban lebih dari satu)",
          "4",
          [
            { label: "A", text: "Hidung" },
            { label: "B", text: "Paru-paru" },
            { label: "C", text: "Jantung" },
            { label: "D", text: "Tenggorokan" },
            { label: "E", text: "Lambung" }
          ],
          "A,B,D"
        )
      );
      // Questions 2 - 10 (Blank slots)
      for (let i = 2; i <= 10; i++) {
        pgkRows.push(
          ...createMcqQuestionRows(
            String(i),
            "",
            "4",
            [
              { label: "A", text: "" },
              { label: "B", text: "" },
              { label: "C", text: "" },
              { label: "D", text: "" },
              { label: "E", text: "" }
            ],
            ""
          )
        );
      }

      const pgkTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: pgkRows
      });

      // Assemble everything!
      const docObj = new Document({
        sections: [
          {
            children: [
              infoBox,
              new Paragraph({
                spacing: { before: 240, after: 120 },
                children: [
                  new TextRun({
                    text: "TEMPLAT BANK SOAL UJIAN (FORMAT MS WORD)",
                    bold: true,
                    size: 24,
                    color: "1e293b"
                  })
                ]
              }),
              new Paragraph({
                spacing: { before: 0, after: 200 },
                children: [
                  new TextRun({
                    text: "Silakan isi soal-soal Anda pada masing-masing tabel khusus di bawah ini. Anda diperbolehkan untuk menghapus baris contoh atau menambahkan baris baru sebanyak mungkin yang Anda butuhkan.",
                    italics: true,
                    size: 18,
                    color: "64748b"
                  })
                ]
              }),

              // Table 1: Pilihan Ganda
              new Paragraph({
                spacing: { before: 200, after: 100 },
                children: [
                  new TextRun({
                    text: "1. TABEL SOAL PILIHAN GANDA (Jenis Soal = 1)",
                    bold: true,
                    size: 20,
                    color: "0284c7"
                  })
                ]
              }),
              mcqTable,

              // Table 2: Listening
              new Paragraph({
                spacing: { before: 300, after: 100 },
                children: [
                  new TextRun({
                    text: "2. TABEL SOAL LISTENING (Jenis Soal = 2)",
                    bold: true,
                    size: 20,
                    color: "0284c7"
                  })
                ]
              }),
              listeningTable,

              // Table 3: Essay
              new Paragraph({
                spacing: { before: 300, after: 100 },
                children: [
                  new TextRun({
                    text: "3. TABEL SOAL ESSAY (Jenis Soal = 3)",
                    bold: true,
                    size: 20,
                    color: "7c3aed"
                  })
                ]
              }),
              essayTable,

              // Table 4: PG Kompleks
              new Paragraph({
                spacing: { before: 300, after: 100 },
                children: [
                  new TextRun({
                    text: "4. TABEL SOAL PILIHAN GANDA KOMPLEKS (Jenis Soal = 4)",
                    bold: true,
                    size: 20,
                    color: "0d9488"
                  })
                ]
              }),
              pgkTable,
            ]
          }
        ]
      });

      const blob = await Packer.toBlob(docObj);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const cleanSubjectName = (subjects.find(s => s.id === selectedSubject)?.name || 'Ujian').replace(/[^a-z0-9]/gi, '_');
      link.download = `Template_Soal_${cleanSubjectName}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Gagal mendownload template Word", error);
      showCustomAlert("Kesalahan", "Terjadi kesalahan saat membuat file template Word (.docx)", false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSubject) return;

    // Deduce template name from Word file name (without extension)
    const lastDotIdx = file.name.lastIndexOf('.');
    const deducedTemplateName = lastDotIdx !== -1 ? file.name.substring(0, lastDotIdx) : file.name;

    if (!deducedTemplateName.trim()) {
      showCustomAlert('Nama File Tidak Valid', 'Nama file template tidak boleh kosong.', false);
      return;
    }

    // Duplicate file check
    if (existingTemplates.includes(deducedTemplateName)) {
      showCustomConfirm(
        'File Sudah Ada',
        `Template soal dengan nama "${deducedTemplateName}" sudah pernah diunggah sebelumnya. Apakah Anda yakin ingin mengunggahnya kembali? Hal ini dapat menyebabkan soal ganda jika data di dalamnya sama.`,
        () => processFileUpload(file, deducedTemplateName),
        true,
        'Ya, Tetap Unggah'
      );
    } else {
      processFileUpload(file, deducedTemplateName);
    }
  };

  const processFileUpload = async (file: File, templateName: string) => {
    setProcessing(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const rawBuffer = evt.target?.result as ArrayBuffer;
        if (!rawBuffer) {
          throw new Error("File array buffer is empty");
        }
        
        // Preprocess Word docx to convert native Word Equation Editor (OMML) formulas into LaTeX
        const arrayBuffer = await preprocessDocxMath(rawBuffer);
        
        const result = await (mammoth as any).convertToHtml(
          { arrayBuffer },
          { 
            styleMap: [
              "u => u",
              "strike => s",
              "b => strong",
              "i => em"
            ],
            convertImage: (mammoth as any).images.imgElement(function(image: any) {
              return image.read("base64").then(function(imageBuffer: any) {
                return {
                  src: "data:" + image.contentType + ";base64," + imageBuffer
                };
              });
            })
          }
        );
        const html = result.value;
        
        // Debugging logs for import
        console.log("DOCX Import - Raw HTML from Mammoth length:", html.length);
        const hasBold = /<(strong|b)/i.test(html);
        const hasItalic = /<(em|i)/i.test(html);
        const hasUnderline = /<(u|ins)/i.test(html);
        console.log(`DOCX Content Detection - Bold: ${hasBold}, Italic: ${hasItalic}, Underline: ${hasUnderline}`);
        
        const parser = new DOMParser();
        const docDom = parser.parseFromString(html, 'text/html');
        const tables = docDom.querySelectorAll('table');
        
        if (tables.length === 0) {
          throw new Error("Tidak ditemukan tabel format soal dalam file Word");
        }

        const questionsRef = collection(db, 'questions');
        let count = 0;
        let batch = writeBatch(db);
        let questionsToUpload: any[] = [];
        
        const parseTypeAndCode = (val: string, numberStr: string) => {
          // Replace non-breaking spaces and other special spaces with regular space
          let cleaned = val.replace(/[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, ' ');
          cleaned = cleaned.trim();
          
          if (!cleaned) {
            return { type: 'pilihan_ganda' as const, typeCode: 1 };
          }
          
          const vLower = cleaned.toLowerCase();
          
          // Match digits 1-5 with any surrounding punctuation or text (e.g. "1.", "5 - PG Kompleks", "Kode 5")
          const has1 = /(^|\b)1(\b|$)/.test(vLower) || vLower === '1' || vLower.startsWith('1.');
          const has2 = /(^|\b)2(\b|$)/.test(vLower) || vLower === '2' || vLower.startsWith('2.');
          const has3 = /(^|\b)3(\b|$)/.test(vLower) || vLower === '3' || vLower.startsWith('3.');
          const has4 = /(^|\b)4(\b|$)/.test(vLower) || vLower === '4' || vLower.startsWith('4.');
          const has5 = /(^|\b)5(\b|$)/.test(vLower) || vLower === '5' || vLower.startsWith('5.');

          if (has1 && !has2 && !has3 && !has4 && !has5) {
            return { type: 'pilihan_ganda' as const, typeCode: 1 };
          }
          if (has2 && !has1 && !has3 && !has4 && !has5) {
            return { type: 'listening' as const, typeCode: 2 };
          }
          if (has3 && !has1 && !has2 && !has4 && !has5) {
            return { type: 'essay' as const, typeCode: 3 };
          }
          if ((has4 || has5) && !has1 && !has2 && !has3) {
            return { type: 'pilihan_ganda_kompleks' as const, typeCode: 4 };
          }

          // If no unique digit, check keywords
          if (vLower.includes('kompleks') || vLower.includes('pgk') || vLower.includes('pg_kompleks') || vLower.includes('multiple_choice_complex')) {
            return { type: 'pilihan_ganda_kompleks' as const, typeCode: 4 };
          }
          if (vLower.includes('listening') || vLower.includes('dengar') || vLower.includes('audio')) {
            return { type: 'listening' as const, typeCode: 2 };
          }
          if (vLower.includes('ganda') || vLower.includes('pilihan') || vLower.includes('pg') || vLower.includes('multiple')) {
            return { type: 'pilihan_ganda' as const, typeCode: 1 };
          }
          if (vLower.includes('essay') || vLower.includes('essai') || vLower.includes('uraian') || vLower.includes('paragraf') || vLower.includes('panjang')) {
            return { type: 'essay' as const, typeCode: 3 };
          }
          if (vLower.includes('singkat') || vLower.includes('isian') || vLower.includes('short')) {
            return { type: 'isian_singkat' as const, typeCode: 3 };
          }

          // Check if there is any '1', '2', '3', '4', '5' anywhere as a last resort
          if (vLower.includes('1')) return { type: 'pilihan_ganda' as const, typeCode: 1 };
          if (vLower.includes('2')) return { type: 'listening' as const, typeCode: 2 };
          if (vLower.includes('3')) return { type: 'essay' as const, typeCode: 3 };
          if (vLower.includes('4') || vLower.includes('5')) return { type: 'pilihan_ganda_kompleks' as const, typeCode: 4 };

          throw new Error(`Soal No. ${numberStr}: Kode soal ${val} tidak dikenali. Gunakan kode 1, 2, 3, atau 4.`);
        };

        const validateAndCleanupQuestion = (qObj: any) => {
          if (qObj.type === 'pilihan_ganda' || qObj.type === 'listening' || qObj.type === 'pilihan_ganda_kompleks') {
            qObj.optionA = stripSimpleHTML(qObj.optionA);
            qObj.optionB = stripSimpleHTML(qObj.optionB);
            qObj.optionC = stripSimpleHTML(qObj.optionC);
            qObj.optionD = stripSimpleHTML(qObj.optionD);
            qObj.optionE = stripSimpleHTML(qObj.optionE);

            const availableOptions: string[] = [];
            if (!isOptionEmpty(qObj.optionA)) availableOptions.push('A'); else qObj.optionA = '';
            if (!isOptionEmpty(qObj.optionB)) availableOptions.push('B'); else qObj.optionB = '';
            if (!isOptionEmpty(qObj.optionC)) availableOptions.push('C'); else qObj.optionC = '';
            if (!isOptionEmpty(qObj.optionD)) availableOptions.push('D'); else qObj.optionD = '';
            if (!isOptionEmpty(qObj.optionE)) availableOptions.push('E'); else qObj.optionE = '';

            if (availableOptions.length === 0) {
              throw new Error(`Soal No. ${qObj.number || ''}: Pilihan Ganda / PG Kompleks harus memiliki setidaknya satu pilihan jawaban.`);
            }

            if (qObj.type === 'pilihan_ganda_kompleks') {
              const rawAns = qObj.correctAnswer ? String(qObj.correctAnswer).toUpperCase() : '';
              const keys = Array.from(new Set(rawAns.replace(/[^A-E]/g, ',').split(',').map(s => s.trim()).filter(Boolean))).sort();
              if (keys.length === 0) {
                throw new Error(`Soal No. ${qObj.number || ''}: Kunci jawaban Pilihan Ganda Kompleks tidak boleh kosong (pilih minimal 1 opsi, contoh: A,C).`);
              }
              for (const k of keys) {
                if (!availableOptions.includes(k)) {
                  throw new Error(`Soal No. ${qObj.number || ''}: Kunci jawaban '${k}' tidak valid karena opsi tersebut kosong atau tidak tersedia.`);
                }
              }
              qObj.correctAnswer = keys.join(',');
            } else {
              const ans = qObj.correctAnswer ? qObj.correctAnswer.trim().toUpperCase() : '';
              qObj.correctAnswer = ans;

              if (!ans) {
                throw new Error(`Soal No. ${qObj.number || ''}: Kunci jawaban tidak boleh kosong.`);
              }

              if (!['A', 'B', 'C', 'D', 'E'].includes(ans)) {
                throw new Error(`Soal No. ${qObj.number || ''}: Kunci jawaban '${ans}' tidak valid (harus A-E).`);
              }

              if (!availableOptions.includes(ans)) {
                throw new Error(`Soal No. ${qObj.number || ''}: Kunci jawaban '${ans}' tidak valid karena opsi tersebut kosong atau tidak tersedia.`);
              }
            }
          }
        };

        // Loop through each table in the document
        for (let k = 0; k < tables.length; k++) {
          const table = tables[k];
          const trs = Array.from(table.querySelectorAll('tr'));
          if (trs.length <= 1) continue; 

          // Detect column mapper
          let colMap = {
            number: -1, question: -1, type: -1, 
            optionLabel: -1, optionContent: -1, correctAnswer: -1
          };
          const headerTds = Array.from(trs[0].querySelectorAll('td')).map(td => td.textContent?.trim().toLowerCase() || '');
          headerTds.forEach((text, idx) => {
            if (text === 'no' || text === 'nomor') colMap.number = idx;
            else if (text.includes('jenis') || text.includes('kode') || text.includes('tipe')) colMap.type = idx;
            else if (text.includes('kunci')) colMap.correctAnswer = idx;
            else if (text === 'opsi' || text === 'label') colMap.optionLabel = idx;
            else if (text === 'jawaban') colMap.optionContent = idx;
            else if (text.includes('soal') || text.includes('pertanyaan')) colMap.question = idx;
          });

          // Fallback mapper for old formats or single-row tables
          let fallbackLabelIdx = -1;
          headerTds.forEach((t, i) => { if(t.includes('pilihan a')) fallbackLabelIdx = i; });

          let currentQ: any = null;

          for (let i = 1; i < trs.length; i++) {
            const tds = trs[i].querySelectorAll('td');
            const rowCells = Array.from(tds).map(td => td.textContent?.trim() || '');
            if (rowCells.length === 0) continue;

            const cellNo = colMap.number !== -1 ? rowCells[colMap.number] : '';
            const cellSoalHTML = colMap.question !== -1 && tds[colMap.question] ? tds[colMap.question].innerHTML : '';
            const cellSoalText = colMap.question !== -1 ? rowCells[colMap.question] : '';
            
            // Logic for finding a new question Row
            // 1. Logic for STARTING A NEW QUESTION: Has a number or a question text in a full-length row
            if (rowCells.length >= 4 && ((cellNo && !isNaN(Number(cellNo))) || cellSoalText)) {
              if (currentQ && currentQ.question.trim()) {
                validateAndCleanupQuestion(currentQ);
                questionsToUpload.push(currentQ);
              }
              
              const parsedInfo = colMap.type !== -1 
                ? parseTypeAndCode(rowCells[colMap.type], cellNo || String(questionsToUpload.length + 1)) 
                : { type: 'pilihan_ganda' as const, typeCode: 1 };

              currentQ = {
                subjectId: selectedSubject,
                packetName: templateName.trim(),
                number: Number(cellNo) || (questionsToUpload.length + 1),
                question: cellSoalHTML,
                optionA: '', optionB: '', optionC: '', optionD: '', optionE: '',
                correctAnswer: colMap.correctAnswer !== -1 ? rowCells[colMap.correctAnswer]?.trim().toUpperCase() : '',
                type: parsedInfo.type,
                typeCode: parsedInfo.typeCode,
                adminId: user!.uid
              };

              // Dummy check for the sample question comparing text
              const cellSoalTextLower = cellSoalText.toLowerCase();
              if (
                cellSoalTextLower.includes("presiden indonesia pada tahun 1999") ||
                cellSoalTextLower.includes("pertanyaan audio listening: manakah") ||
                cellSoalTextLower.includes("gas apa yang paling banyak terkandung") ||
                cellSoalTextLower.includes("jelaskan pengertian ekologi laut")
              ) {
                 currentQ = null; continue;
              }
            }

            // 2. Logic for READING OPTIONS (Can be in the same row or subsequent sub-rows)
            if (currentQ) {
              let label = '';
              let content = '';

              let contentHTML = '';

              // Try mapping by index if columns exist
              if (colMap.optionLabel !== -1 && rowCells[colMap.optionLabel]) {
                label = rowCells[colMap.optionLabel].trim().toUpperCase();
                contentHTML = colMap.optionContent !== -1 && tds[colMap.optionContent] ? tds[colMap.optionContent].innerHTML : '';
                content = colMap.optionContent !== -1 ? rowCells[colMap.optionContent]?.trim() : '';
              } 
              // Fallback for vertically merged rows where columns shift left
              else if (rowCells.length >= 2 && rowCells.length < 6) {
                // Usually the first 2 columns in a merged sub-row are OPSI and JAWABAN
                label = rowCells[0].trim().toUpperCase();
                contentHTML = tds[1] ? tds[1].innerHTML : '';
                content = rowCells[1].trim();
              }

              // Apply the option if valid label found
              if (['A', 'B', 'C', 'D', 'E'].includes(label)) {
                if (label === 'A') currentQ.optionA = contentHTML || content;
                else if (label === 'B') currentQ.optionB = contentHTML || content;
                else if (label === 'C') currentQ.optionC = contentHTML || content;
                else if (label === 'D') currentQ.optionD = contentHTML || content;
                else if (label === 'E') currentQ.optionE = contentHTML || content;
              }
            }
          }
          if (currentQ && currentQ.question.trim()) {
            validateAndCleanupQuestion(currentQ);
            questionsToUpload.push(currentQ);
          }
        }

        if (questionsToUpload.length === 0) {
          throw new Error("Tidak ada soal baru yang berhasil diimpor.");
        }

        const totalQ = questionsToUpload.length;
        const typeUnits: Record<string, number> = { 'pilihan_ganda': 1, 'pilihan_ganda_kompleks': 2, 'listening': 5, 'essay': 10 };
        let totalUnits = 0;
        questionsToUpload.forEach(q => {
          totalUnits += typeUnits[q.type] || 1;
        });

        const unitValue = 100 / totalUnits;
        let currentWeightSum = 0;

        for (let idx = 0; idx < questionsToUpload.length; idx++) {
          const qData = questionsToUpload[idx];
          const newDoc = doc(collection(db, 'questions'));
          
          let qWeight = (typeUnits[qData.type] || 1) * unitValue;
          
          // Adjust last item to ensure total is exactly 100
          if (idx === questionsToUpload.length - 1) {
            qWeight = 100 - currentWeightSum;
          } else {
            qWeight = Number(qWeight.toFixed(2));
            currentWeightSum += qWeight;
          }

          batch.set(newDoc, {
            ...qData,
            weight: qWeight,
            createdAt: Date.now()
          });
          count++;

          if (count % 500 === 0) {
            await batch.commit();
            batch = writeBatch(db);
          }
        }

        if (count % 500 !== 0) {
          await batch.commit();
        }

        const msg = `Berhasil mengimpor ${count} soal ke dalam template "${templateName}". Bobot setiap soal telah disesuaikan secara otomatis berdasarkan proporsi tipe soal (Essay > Listening > Pilihan Ganda Kompleks > Pilihan Ganda) dengan total skor maksimal setara 100.`;
        showCustomAlert('Berhasil Impor', msg, true);
        setSelectedTemplateFilter(templateName.trim());
        fetchQuestions();
        fetchExistingTemplates();
        setIsDirty(true);
      } catch (err: any) {
        console.error(err);
        showCustomAlert('Gagal Impor', err.message || 'Gagal membaca file Word. Pastikan format sesuai template.', false);
      }
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDeleteQuestion = (id: string) => {
    const qToDelete = questions.find(q => q.id === id);
    if (!qToDelete) {
      console.warn("Question not found in local state:", id);
      return;
    }

    const questionNumber = questions.findIndex(item => item.id === id) + 1;

    showCustomConfirm(
      `Hapus Soal No. ${questionNumber}`,
      `Apakah Anda yakin ingin menghapus Soal No. ${questionNumber} ini dari paket soal? Total bobot nilai akan otomatis disesuaikan kembali menjadi 100.`,
      async () => {
        setProcessing(true);
        console.log("Attempting to delete question with ID:", id);

        // 1. Immediately remove from local state for instant UI update
        const remaining = questions.filter(q => q.id !== id);
        setQuestions(remaining);
        setOriginalQuestions(remaining);

        try {
          // 2. Delete document from Firestore
          await deleteDoc(doc(db, 'questions', id));
          console.log("Question document deleted from Firestore");

          // 3. Clear custom weight override in localStorage
          if (selectedSubject && qToDelete.packetName) {
            const key = `cbt_custom_weights_${selectedSubject}_${qToDelete.packetName}`;
            try { localStorage.removeItem(key); } catch {}
          }
          setHasEditedWeights(false);

          // 4. Rebalance weights in Firestore so total weight stays 100
          if (selectedSubject && qToDelete.packetName) {
            await autoAdjustWeights(selectedSubject, qToDelete.packetName, id);
            console.log("Weights rebalanced in Firestore");
          }

          // 5. Fetch updated questions from Firestore to synchronize
          await fetchQuestions();

          showCustomAlert(
            'Soal Berhasil Dihapus',
            `Soal No. ${questionNumber} berhasil dihapus dan bobot nilai otomatis disesuaikan kembali menjadi 100.`,
            true
          );
        } catch (err: any) {
          console.error("Error deleting question:", err);
          await fetchQuestions();
          showCustomAlert('Gagal Hapus', err?.message || 'Terjadi kesalahan saat menghapus soal.', false);
        } finally {
          setProcessing(false);
        }
      },
      true,
      'Hapus Soal'
    );
  };

  const handleDeleteTemplate = (templateName: string) => {
    if (!templateName) return;
    showCustomConfirm(
      'Hapus Template Soal',
      `Hapus SEMUA soal dalam template "${templateName}"? Tindakan ini tidak dapat dibatalkan.`,
      async () => {
        setProcessing(true);
        try {
          const q = query(
            collection(db, 'questions'), 
            where('subjectId', '==', selectedSubject),
            where('packetName', '==', templateName)
          );
          const snap = await getDocs(q);
          const docs = snap.docs;
          const chunkSize = 500;
          for (let i = 0; i < docs.length; i += chunkSize) {
            const batch = writeBatch(db);
            const chunk = docs.slice(i, i + chunkSize);
            chunk.forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
          
          showCustomAlert('Berhasil Hapus', `Berhasil menghapus template "${templateName}"`, true);
          if (selectedTemplateFilter === templateName) {
            setSelectedTemplateFilter('all');
          }
          fetchQuestions();
          fetchExistingTemplates();
          setIsDirty(true);
        } catch (err) {
          console.error(err);
          showCustomAlert('Gagal Hapus', 'Gagal menghapus template soal.', false);
        }
        setProcessing(false);
      },
      true,
      'Hapus Template'
    );
  };

  const handleRenameTemplate = (oldName: string) => {
    if (!oldName) return;
    showCustomPrompt(
      'Ubah Nama Berkas Template',
      `Ganti nama berkas template "${oldName}" menjadi:`,
      oldName,
      'Nama template baru...',
      async (newName) => {
        if (!newName || !newName.trim() || newName.trim() === oldName) return;
        
        setProcessing(true);
        try {
          const q = query(
            collection(db, 'questions'), 
            where('subjectId', '==', selectedSubject),
            where('packetName', '==', oldName)
          );
          const snap = await getDocs(q);
          const docs = snap.docs;
          const chunkSize = 500;
          for (let i = 0; i < docs.length; i += chunkSize) {
            const batch = writeBatch(db);
            const chunk = docs.slice(i, i + chunkSize);
            chunk.forEach(d => {
              batch.update(d.ref, { packetName: newName.trim() });
            });
            await batch.commit();
          }
          
          showCustomAlert('Berhasil Rename', `Berhasil mengubah nama template menjadi "${newName.trim()}"`, true);
          if (selectedTemplateFilter === oldName) {
            setSelectedTemplateFilter(newName.trim());
          }
          fetchQuestions();
          fetchExistingTemplates();
          setIsDirty(true);
        } catch (err) {
          console.error(err);
          showCustomAlert('Gagal Rename', 'Gagal mengubah nama template.', false);
        }
        setProcessing(false);
      }
    );
  };

  const startEditing = (q: Question) => {
    setEditingQuestionId(q.id || null);
    const cleanedQ = {
      ...q,
      optionA: stripSimpleHTML(q.optionA),
      optionB: stripSimpleHTML(q.optionB),
      optionC: stripSimpleHTML(q.optionC),
      optionD: stripSimpleHTML(q.optionD),
      optionE: stripSimpleHTML(q.optionE),
    };
    setEditingData(cleanedQ);
    setOriginalEditingData({ ...cleanedQ });
  };

  const cancelEditing = () => {
    setEditingQuestionId(null);
    setEditingData(null);
    setOriginalEditingData(null);
  };

  const handleUpdateQuestion = async () => {
    if (!editingQuestionId || !editingData || !user) return;
    setProcessing(true);
    try {
      const qType = editingData.type || 'pilihan_ganda';
      const isPg = qType === 'pilihan_ganda' || qType === 'listening' || qType === 'pilihan_ganda_kompleks';
      
      if (isPg) {
        const availableOptions: string[] = [];
        if (!isOptionEmpty(editingData.optionA)) availableOptions.push('A');
        if (!isOptionEmpty(editingData.optionB)) availableOptions.push('B');
        if (!isOptionEmpty(editingData.optionC)) availableOptions.push('C');
        if (!isOptionEmpty(editingData.optionD)) availableOptions.push('D');
        if (!isOptionEmpty(editingData.optionE)) availableOptions.push('E');

        if (availableOptions.length === 0) {
          showCustomAlert('Opsi Kosong', 'Soal Pilihan Ganda / PG Kompleks / Listening harus memiliki setidaknya satu pilihan jawaban.', false);
          setProcessing(false);
          return;
        }

        if (qType === 'pilihan_ganda_kompleks') {
          const rawAns = editingData.correctAnswer ? String(editingData.correctAnswer).toUpperCase() : '';
          const keys = Array.from(new Set(rawAns.replace(/[^A-E]/g, ',').split(',').map(s => s.trim()).filter(Boolean))).sort();
          if (keys.length === 0) {
            showCustomAlert('Kunci Jawaban Kosong', 'Pilih minimal 1 opsi kunci jawaban untuk Pilihan Ganda Kompleks.', false);
            setProcessing(false);
            return;
          }
          for (const k of keys) {
            if (!availableOptions.includes(k)) {
              showCustomAlert('Kunci Jawaban Tidak Valid', `Kunci jawaban '${k}' tidak valid karena opsi tersebut kosong.`, false);
              setProcessing(false);
              return;
            }
          }
          editingData.correctAnswer = keys.join(',');
        } else {
          const ans = editingData.correctAnswer ? editingData.correctAnswer.toUpperCase() : 'A';
          if (!availableOptions.includes(ans)) {
            showCustomAlert('Kunci Jawaban Tidak Valid', `Kunci jawaban '${ans}' tidak valid karena opsi tersebut kosong atau tidak tersedia.`, false);
            setProcessing(false);
            return;
          }
        }
      }

      const mapTypeToCode = (t: string): number => {
        if (t === 'pilihan_ganda_kompleks') return 4;
        if (t === 'listening') return 2;
        if (t === 'essay') return 3;
        if (t === 'isian_singkat') return 3;
        return 1; // 'pilihan_ganda'
      };

      const rawWeight = editingData.weight;
      const parsedWeight = rawWeight !== undefined && rawWeight !== null && rawWeight !== '' && !isNaN(Number(rawWeight))
        ? Number(rawWeight)
        : (qType === 'essay' ? 10 : qType === 'listening' ? 5 : qType === 'pilihan_ganda_kompleks' ? 2 : 1);

      await updateDoc(doc(db, 'questions', editingQuestionId), {
        number: Number(editingData.number),
        question: editingData.question || '',
        optionA: isPg ? stripSimpleHTML(editingData.optionA) : '',
        optionB: isPg ? stripSimpleHTML(editingData.optionB) : '',
        optionC: isPg ? stripSimpleHTML(editingData.optionC) : '',
        optionD: isPg ? stripSimpleHTML(editingData.optionD) : '',
        optionE: isPg ? stripSimpleHTML(editingData.optionE) : '',
        correctAnswer: isPg ? String(editingData.correctAnswer || (qType === 'pilihan_ganda_kompleks' ? 'A' : 'A')) : (editingData.correctAnswer || ''),
        type: qType,
        typeCode: mapTypeToCode(qType),
        weight: parsedWeight,
        lastEditedAt: Date.now()
      } as any);

      // Track if the user has customized question points
      const origWeight = originalEditingData?.weight !== undefined ? Number(originalEditingData.weight) : 0;
      if (Math.abs(parsedWeight - origWeight) > 0.001) {
        setHasEditedWeights(true);
        if (selectedSubject && editingData.packetName) {
          try {
            localStorage.setItem(`cbt_custom_weights_${selectedSubject}_${editingData.packetName}`, 'true');
          } catch {}
        }
      }
      
      setEditingQuestionId(null);
      setEditingData(null);
      fetchQuestions();
      setIsDirty(true);
    } catch (err) {
      console.error(err);
      showCustomAlert('Gagal Menyimpan', 'Gagal menyimpan perubahan ke server.', false);
    }
    setProcessing(false);
  };

  const handleAddQuestion = async () => {
    if (!user || !selectedSubject || selectedTemplateFilter === 'all') return;
    setProcessing(true);
    try {
      const qType = addingData.type || 'pilihan_ganda';
      const isPg = qType === 'pilihan_ganda' || qType === 'listening' || qType === 'pilihan_ganda_kompleks';

      if (isPg) {
        const availableOptions: string[] = [];
        if (!isOptionEmpty(addingData.optionA)) availableOptions.push('A');
        if (!isOptionEmpty(addingData.optionB)) availableOptions.push('B');
        if (!isOptionEmpty(addingData.optionC)) availableOptions.push('C');
        if (!isOptionEmpty(addingData.optionD)) availableOptions.push('D');
        if (!isOptionEmpty(addingData.optionE)) availableOptions.push('E');

        if (availableOptions.length === 0) {
          showCustomAlert('Opsi Kosong', 'Soal Pilihan Ganda / PG Kompleks / Listening harus memiliki setidaknya satu pilihan jawaban.', false);
          setProcessing(false);
          return;
        }

        if (qType === 'pilihan_ganda_kompleks') {
          const rawAns = addingData.correctAnswer ? String(addingData.correctAnswer).toUpperCase() : '';
          const keys = Array.from(new Set(rawAns.replace(/[^A-E]/g, ',').split(',').map(s => s.trim()).filter(Boolean))).sort();
          if (keys.length === 0) {
            showCustomAlert('Kunci Jawaban Kosong', 'Pilih minimal 1 opsi kunci jawaban untuk Pilihan Ganda Kompleks.', false);
            setProcessing(false);
            return;
          }
          for (const k of keys) {
            if (!availableOptions.includes(k)) {
              showCustomAlert('Kunci Jawaban Tidak Valid', `Kunci jawaban '${k}' tidak valid karena opsi tersebut kosong.`, false);
              setProcessing(false);
              return;
            }
          }
          addingData.correctAnswer = keys.join(',');
        } else {
          const ans = addingData.correctAnswer ? addingData.correctAnswer.toUpperCase() : 'A';
          if (!availableOptions.includes(ans)) {
            showCustomAlert('Kunci Jawaban Tidak Valid', `Kunci jawaban '${ans}' tidak valid karena opsi tersebut kosong atau tidak tersedia.`, false);
            setProcessing(false);
            return;
          }
        }
      }

      const newNumber = Number(addingData.number || 1);
      
      // Batch operation
      const batch = writeBatch(db);
      
      // 1. Identify questions that need renumbering
      const questionsToRenumber = questions.filter(q => q.number >= newNumber);
      
      // 2. Add renumber operations to batch (sort descending to avoid conflicts)
      questionsToRenumber.sort((a, b) => b.number - a.number).forEach(q => {
        const qRef = doc(db, 'questions', q.id!);
        batch.update(qRef, { number: q.number + 1 });
      });
      
      // 3. Add the new question
      const mapTypeToCode = (t: string): number => {
        if (t === 'pilihan_ganda_kompleks') return 4;
        if (t === 'listening') return 2;
        if (t === 'essay') return 3;
        if (t === 'isian_singkat') return 3;
        return 1; // 'pilihan_ganda'
      };

      const qRef = doc(collection(db, 'questions'));
      const docData = {
        number: newNumber,
        subjectId: selectedSubject,
        packetName: selectedTemplateFilter,
        adminId: user.uid,
        createdAt: Date.now(),
        question: addingData.question || '',
        optionA: isPg ? stripSimpleHTML(addingData.optionA) : '',
        optionB: isPg ? stripSimpleHTML(addingData.optionB) : '',
        optionC: isPg ? stripSimpleHTML(addingData.optionC) : '',
        optionD: isPg ? stripSimpleHTML(addingData.optionD) : '',
        optionE: isPg ? stripSimpleHTML(addingData.optionE) : '',
        correctAnswer: isPg ? String(addingData.correctAnswer || (qType === 'pilihan_ganda_kompleks' ? 'A' : 'A')) : (addingData.correctAnswer || ''),
        type: qType,
        typeCode: mapTypeToCode(qType),
        weight: Number(addingData.weight !== undefined && addingData.weight !== null && addingData.weight !== 0 ? addingData.weight : (qType === 'essay' ? 10 : qType === 'listening' ? 5 : qType === 'pilihan_ganda_kompleks' ? 2 : 1))
      };
      
      batch.set(qRef, docData);
      
      await batch.commit();
      
      // Auto adjust weights to sum to 100 if user has not set custom weights
      if (!hasEditedWeights) {
        await autoAdjustWeights(selectedSubject, selectedTemplateFilter!);
      }
      
      setIsAddingQuestion(false);
      setAddingData({
        number: questions.length + 2, // Predictive for next add
        question: '',
        optionA: '',
        optionB: '',
        optionC: '',
        optionD: '',
        optionE: '',
        correctAnswer: 'A',
        weight: 1,
        type: 'pilihan_ganda'
      });
      fetchQuestions();
      setIsDirty(true);
      showCustomAlert('Berhasil', 'Soal berhasil ditambahkan.', true);
    } catch (err) {
      console.error(err);
      showCustomAlert('Gagal', 'Gagal menambahkan soal.', false);
    }
    setProcessing(false);
  };

  const handleExportQuestions = () => {
    if (selectedTemplateFilter === 'all' || questions.length === 0) return;
    
    const exportData = questions.map(q => ({
      'Nomor': q.number,
      'Pertanyaan': q.question,
      'PilihanA': q.optionA,
      'PilihanB': q.optionB,
      'PilihanC': q.optionC,
      'PilihanD': q.optionD,
      'PilihanE': q.optionE,
      'JawabanBenar': q.correctAnswer,
      'BobotNilai': q.weight
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DataSoal');
    XLSX.writeFile(wb, `Export_${selectedTemplateFilter}_${selectedSubject}.xlsx`);
  };

  const handleValidateWeights = () => {
    if (selectedTemplateFilter === 'all') return;
    const total = questions.reduce((acc, q) => acc + (q.weight || 0), 0);
    if (total !== 100) {
      showCustomAlert(
        'Bobot Saat Ini', 
        `Total bobot soal saat ini adalah ${total.toFixed(2)}. Sistem akan tetap menghitung nilai siswa dalam skala 100 dengan rumus (skor/total_bobot * 100). Namun, kami menyarankan total bobot 100 untuk transparansi penilaian yang lebih mudah.`,
        false
      );
    } else {
      showCustomAlert('Sempurna', 'Total bobot soal sudah bernilai 100. Penilaian Anda kini sangat proporsional.', true);
      setIsDirty(false);
    }
  };

  const filteredTemplates = existingTemplates.filter(t => 
    t.toLowerCase().includes(searchTemplateQuery.toLowerCase())
  );

  const displayedQuestions = questions.filter(q => 
    q.question.toLowerCase().includes(searchQuestionQuery.toLowerCase()) ||
    String(q.number).includes(searchQuestionQuery) ||
    String(q.optionA || '').toLowerCase().includes(searchQuestionQuery.toLowerCase()) ||
    String(q.optionB || '').toLowerCase().includes(searchQuestionQuery.toLowerCase()) ||
    String(q.optionC || '').toLowerCase().includes(searchQuestionQuery.toLowerCase()) ||
    String(q.optionD || '').toLowerCase().includes(searchQuestionQuery.toLowerCase()) ||
    String(q.optionE || '').toLowerCase().includes(searchQuestionQuery.toLowerCase())
  );

  return (
    <div className="w-full flex-1 flex flex-col h-full min-h-0">
      {/* Header bar / Top Control */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Bank Soal</h3>
            <p className="text-xs text-slate-500">Kumpulan berkas template soal ujian mata pelajaran</p>
          </div>
          
          <select
            value={selectedSubject}
            onChange={e => {
              setSelectedSubject(e.target.value);
              setSelectedTemplateFilter(null);
            }}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded text-xs font-semibold uppercase focus:ring-1 focus:ring-blue-500 outline-none w-full md:w-56 transition-colors cursor-pointer"
          >
            <option value="">-- PILIH MATA PELAJARAN --</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="flex items-center space-x-2">
          <button 
            onClick={handleDownloadTemplate}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded flex items-center space-x-1.5 transition-colors text-xs font-bold uppercase border border-slate-300 shadow-sm"
          >
            <Download className="w-4 h-4" />
            <span>Unduh Format Word (DOCX)</span>
          </button>
          
          <input 
            type="file" 
            accept=".docx" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            className="hidden" 
          />
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={processing || !selectedSubject}
            className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded flex items-center space-x-1.5 transition-colors text-xs font-bold uppercase shadow-sm disabled:opacity-50 disabled:hover:bg-green-600"
            title={!selectedSubject ? "Pilih mata pelajaran terlebih dahulu untuk membuka tombol import" : "Import template soal Word"}
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            <span>Import Word (DOCX)</span>
          </button>
        </div>
      </div>

      {/* Main split dashboard or empty state */}
      {!selectedSubject ? (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col items-center justify-center flex-1 p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 border border-slate-200 text-slate-400">
            <FileText className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-slate-800 mb-1">Mata Pelajaran Belum Dipilih</h3>
          <p className="text-xs text-slate-500 max-w-sm mb-4">Pilih mata pelajaran di atas terlebih dahulu untuk memuat daftar template soal serta membuka akses pengunggahan.</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row h-full min-h-0 gap-4">
          {/* Left Panel: List of Templates */}
          <div className="w-full md:w-80 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col min-h-[250px] md:min-h-0">
            <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Daftar Template Soal</span>
              
              {/* Template Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                <input 
                  type="text"
                  value={searchTemplateQuery}
                  onChange={e => setSearchTemplateQuery(e.target.value)}
                  placeholder="Cari berkas template..."
                  className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 text-xs rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <div className="w-full text-left px-3 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-between text-slate-700">
                <span className="pointer-events-none">Jumlah File</span>
                <button
                    onClick={() => setSelectedTemplateFilter('all')}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    selectedTemplateFilter === 'all' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-black/10 text-slate-700 hover:bg-black/20'
                    }`}
                    title="Klik untuk melihat semua berkas"
                >
                  {existingTemplates.length} Berkas
                </button>
              </div>

              <div className="my-2 border-t border-slate-100" />

              {filteredTemplates.length === 0 ? (
                <div className="text-center p-6 text-[11px] text-slate-500 uppercase font-medium">
                  {existingTemplates.length === 0 ? "Belum ada berkas diunggah" : "Tidak ditemukan"}
                </div>
              ) : (
                filteredTemplates.map(tmpl => {
                  const isActive = selectedTemplateFilter === tmpl;
                  return (
                    <div 
                      key={tmpl}
                      className={`group relative flex items-center justify-between rounded-md p-1 transition-all ${
                        isActive ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50'
                      }`}
                    >
                      <button
                        onClick={() => setSelectedTemplateFilter(tmpl)}
                        className={`flex-1 text-left px-2 py-1.5 text-xs truncate font-semibold uppercase ${
                          isActive ? 'text-blue-700 font-bold' : 'text-slate-600'
                        }`}
                        title={tmpl}
                      >
                        {tmpl}
                      </button>

                      <div className="flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity absolute right-1 bg-gradient-to-l from-white pl-4 group-hover:from-slate-50 p-0.5 rounded">
                        <button
                          onClick={() => handleRenameTemplate(tmpl)}
                          className="p-1 hover:bg-slate-200 rounded text-slate-500 hover:text-blue-600 transition"
                          title="Ganti nama berkas template"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(tmpl)}
                          className="p-1 hover:bg-red-100 rounded text-slate-500 hover:text-red-600 transition"
                          title="Hapus berkas template"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            {/* Explanatory helper card */}
            <div className="p-3 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-500 rounded-b-lg">
              <p className="leading-relaxed">💡 Anda dapat <strong>mengganti nama file Excel</strong> di komputer Anda sebelum/sesudah diunduh. Berkas yang Anda impor akan otomatis terdaftar sesuai dengan nama file-nya.</p>
            </div>
          </div>

          {/* Right Panel: Questions Preview & Direct Editing */}
          <div className="flex-1 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col min-h-0">
            {/* Right Panel Header */}
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-slate-50/50 rounded-t-lg">
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-bold text-blue-700 uppercase tracking-widest bg-blue-50 px-2.5 py-1 border border-blue-100 rounded">
                  {selectedTemplateFilter === null ? "Pilih Template" : selectedTemplateFilter === 'all' ? "Tinjauan Semua Soal" : `${selectedTemplateFilter}`}
                </span>
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider bg-slate-100 px-2.5 py-1 border border-slate-200 rounded">
                  {questions.length} Soal
                </span>
                {questions.length > 0 && selectedTemplateFilter !== null && (
                  <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 border rounded flex items-center space-x-1 ${
                    isWeight100 
                      ? 'bg-green-50 text-green-700 border-green-200' 
                      : 'bg-amber-50 text-amber-700 border-amber-300'
                  }`}>
                    <span>Bobot:</span>
                    <span>{totalWeight % 1 === 0 ? totalWeight.toFixed(0) : totalWeight.toFixed(2).replace(/\.?0+$/, '')} / 100</span>
                  </span>
                )}
              </div>

            <div className="flex items-center space-x-2">
                {selectedTemplateFilter !== null && selectedTemplateFilter !== 'all' && (
                  <>
                    <button 
                      onClick={() => {
                        setAddingData({
                          ...addingData,
                          number: questions.length + 1,
                          type: addingData.type || 'pilihan_ganda'
                        });
                        setIsAddingQuestion(true);
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-bold uppercase flex items-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah Soal</span>
                    </button>
                  </>
                )}
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
                  <input 
                    type="text"
                    value={searchQuestionQuery}
                    onChange={e => setSearchQuestionQuery(e.target.value)}
                    placeholder="Cari kata kunci..."
                    className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 text-xs rounded outline-none focus:ring-1 focus:ring-blue-500 w-32 md:w-44"
                  />
                </div>
              </div>
            </div>

            {/* Weight Warning & Reset Notification Banner */}
            {questions.length > 0 && selectedTemplateFilter !== null && !isWeight100 && (
              <div className="mx-4 mt-3 mb-1 p-3 bg-amber-50 border border-amber-300 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 shadow-xs">
                <div className="flex items-start space-x-2.5">
                  <span className="text-base leading-none shrink-0 mt-0.5">⚠️</span>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-amber-800">
                      Peringatan Bobot Soal: Total Bobot Saat Ini {totalWeight % 1 === 0 ? totalWeight.toFixed(0) : totalWeight.toFixed(2).replace(/\.?0+$/, '')} / 100
                    </div>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      {weightDiff > 0 
                        ? `Total bobot soal belum genap 100 (Kurang ${weightDiff} poin). Sesuaikan nilai per soal atau gunakan tombol reset sistem.`
                        : `Total bobot soal melebihi 100 (Kelebihan ${Math.abs(weightDiff)} poin). Sesuaikan nilai per soal atau gunakan tombol reset sistem.`}
                    </p>
                  </div>
                </div>
                {hasEditedWeights && (
                  <button
                    type="button"
                    onClick={handleResetWeightsTo100}
                    disabled={processing}
                    className="shrink-0 inline-flex items-center space-x-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-xs font-bold rounded shadow-xs transition-colors cursor-pointer self-start sm:self-auto"
                    title="Reset pembagian bobot nilai ke standar sistem agar otomatis kembali genap 100"
                  >
                    <span>↺ Reset Bobot ke 100 (Sistem)</span>
                  </button>
                )}
              </div>
            )}

            {/* Questions List */}
            <div className="overflow-auto flex-1 divide-y divide-slate-100">
              {isAddingQuestion && (
                <div className="p-4 bg-green-50/40 border-l-4 border-green-500 space-y-3 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-green-800 uppercase tracking-wider">Tambah Soal Baru</span>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={handleAddQuestion}
                        disabled={processing}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-[10px] font-bold uppercase flex items-center space-x-1 shadow transition cursor-pointer"
                      >
                        {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        <span>Tambah</span>
                      </button>
                      <button
                        onClick={() => setIsAddingQuestion(false)}
                        className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10px] font-bold uppercase flex items-center space-x-1 transition cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Batal</span>
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">No. Soal</label>
                      <input 
                        type="number"
                        value={addingData.number || ''}
                        onChange={e => setAddingData({ ...addingData, number: parseInt(e.target.value) || 1 })}
                        className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Tipe Soal</label>
                      <select
                        value={addingData.type || 'pilihan_ganda'}
                        onChange={e => {
                          const val = e.target.value as any;
                          const weightUnits: Record<string, number> = { 'pilihan_ganda': 1, 'pilihan_ganda_kompleks': 2, 'listening': 5, 'essay': 10 };
                          setAddingData({ 
                            ...addingData, 
                            type: val,
                            weight: weightUnits[val] || 1,
                            correctAnswer: val === 'pilihan_ganda_kompleks' ? 'A,B' : (val === 'pilihan_ganda' || val === 'listening') ? 'A' : '' 
                          });
                        }}
                        className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800 cursor-pointer"
                      >
                        <option value="pilihan_ganda">Pilihan Ganda</option>
                        <option value="pilihan_ganda_kompleks">Pilihan Ganda Kompleks</option>
                        <option value="listening">Listening</option>
                        <option value="essay">Essay</option>
                      </select>
                    </div>
                    <div className="md:col-span-6">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5 flex flex-wrap items-center">
                        <span>Teks Pertanyaan</span>
                        <span className="ml-1.5 text-[9px] text-amber-600 font-semibold lowercase italic normal-case bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">(Tips: Klik gambar untuk mengubah ukuran)</span>
                      </label>
                      <div className="h-64 mb-12">
                        <RichTextEditor 
                          placeholder="Ketik pertanyaan di sini..."
                          value={addingData.question || ''}
                          onChange={value => setAddingData(prev => ({ ...prev, question: value }))}
                          className="h-full"
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Bobot Nilai</label>
                      <input 
                        type="number"
                        step="any"
                        min="0"
                        value={addingData.weight !== undefined && addingData.weight !== null ? addingData.weight : ''}
                        onChange={e => {
                          const val = e.target.value;
                          setAddingData({ ...addingData, weight: val === '' ? ('' as any) : parseFloat(val) || 0 });
                        }}
                        className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800"
                      />
                    </div>
                  </div>

                  {addingData.type === 'pilihan_ganda' || addingData.type === 'listening' || addingData.type === 'pilihan_ganda_kompleks' || !addingData.type ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        {['A', 'B', 'C', 'D', 'E'].map(l => (
                          <div key={l} className="relative group space-y-1">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                              Pilihan {l}
                            </label>
                            <div className="flex items-center space-x-1">
                              <input 
                                type="text"
                                value={(addingData as any)[`option${l}`] || ''}
                                onChange={e => setAddingData({ ...addingData, [`option${l}`]: e.target.value })}
                                placeholder={`Pilihan ${l}...`}
                                className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <button 
                                type="button"
                                onClick={() => setAddingData({ ...addingData, [`option${l}`]: '' })}
                                className="p-1 hover:text-red-500 text-slate-300 transition-colors"
                                title="Reset Pilihan"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            {/* Live formula / math preview */}
                            {(addingData as any)[`option${l}`] && (
                              <div className="bg-slate-50 rounded border border-slate-200 px-2 py-1 min-h-[26px] text-xs text-slate-800 flex items-center overflow-x-auto shadow-3xs" title="Pratinjau tampilan rumus">
                                <span className="text-[9px] font-bold text-blue-600 mr-1.5 select-none shrink-0 uppercase tracking-wider">Hasil:</span>
                                <div 
                                  className="ql-editor p-0 text-xs inline-block [&_p]:m-0 [&_p]:p-0"
                                  dir="auto"
                                  dangerouslySetInnerHTML={{ __html: formatHTML(String((addingData as any)[`option${l}`])) }}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {addingData.type === 'pilihan_ganda_kompleks' ? (
                        <div>
                          <label className="block text-[10px] font-bold text-teal-700 uppercase mb-1">
                            Jawaban Benar (Bisa Pilih Lebih Dari 1 Opsi)
                          </label>
                          <div className="flex items-center space-x-4 bg-white p-2 border border-slate-300 rounded w-max">
                            {['A', 'B', 'C', 'D', 'E'].map(l => {
                              const isChecked = (addingData.correctAnswer || '').split(',').map(s => s.trim()).includes(l);
                              return (
                                <label key={l} className="flex items-center space-x-1.5 cursor-pointer text-xs font-bold text-slate-700 select-none">
                                  <input 
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => setAddingData({ ...addingData, correctAnswer: togglePgkKey(addingData.correctAnswer, l) })}
                                    className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500 cursor-pointer"
                                  />
                                  <span>{l}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                            Jawaban Benar
                          </label>
                          <select
                            value={addingData.correctAnswer || 'A'}
                            onChange={e => setAddingData({ ...addingData, correctAnswer: e.target.value })}
                            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none font-bold text-slate-700 focus:ring-1 focus:ring-blue-500 cursor-pointer animate-fade-in"
                          >
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                            <option value="D">D</option>
                            <option value="E">E</option>
                          </select>
                        </div>
                      )}
                    </>
                  ) : addingData.type === 'isian_singkat' ? (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Jawaban Singkat yang Benar</label>
                      <input 
                        type="text"
                        value={addingData.correctAnswer || ''}
                        onChange={e => setAddingData({ ...addingData, correctAnswer: e.target.value })}
                        placeholder="Contoh: Nitrogen (Sistem mencocokkan jawaban tanpa sensitifitas huruf besar/kecil)"
                        className="w-full max-w-xl px-3 py-2 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Contoh Kunci Jawaban / Pedoman Penilaian (Opsional)</label>
                      <textarea
                        rows={3}
                        value={addingData.correctAnswer || ''}
                        onChange={e => setAddingData({ ...addingData, correctAnswer: e.target.value })}
                        placeholder="Masukkan poin jawaban pokok sebagai pedoman koreksi nilai essay siswa nanti"
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800"
                      />
                    </div>
                  )}
                </div>
              )}
              {loading ? (
                <div className="flex justify-center p-12">
                   <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                </div>
              ) : displayedQuestions.length === 0 ? (
                <div className="text-center p-12 text-slate-400 text-xs font-bold uppercase tracking-wider">
                  {selectedTemplateFilter === null ? "Pilih berkas template soal terlebih dahulu" : (questions.length === 0 ? "Belum ada soal" : "Tidak ada yang cocok dengan pencarian")}
                </div>
              ) : (
                displayedQuestions.map((q) => {
                  const isEditing = editingQuestionId === q.id;
                  
                  if (isEditing && editingData) {
                    return (
                      <div key={q.id} className="p-4 bg-blue-50/40 border-l-4 border-blue-500 space-y-3 transition-all">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">Mode Edit Soal</span>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={handleUpdateQuestion}
                              disabled={processing}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-bold uppercase flex items-center space-x-1 shadow transition cursor-pointer"
                            >
                              {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              <span>Simpan</span>
                            </button>
                            <button
                              onClick={cancelEditing}
                              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[10px] font-bold uppercase flex items-center space-x-1 transition cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Batal</span>
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                          <div className="md:col-span-2">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">No. Soal</label>
                            <input 
                              type="number"
                              value={editingData.number || ''}
                              onChange={e => setEditingData({ ...editingData, number: parseInt(e.target.value) || 1 })}
                              className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Tipe Soal</label>
                            <select
                              value={editingData.type || 'pilihan_ganda'}
                              onChange={e => {
                                const val = e.target.value as any;
                                const weightUnits: Record<string, number> = { 'pilihan_ganda': 1, 'pilihan_ganda_kompleks': 2, 'listening': 5, 'essay': 10 };
                                setEditingData({ 
                                  ...editingData, 
                                  type: val,
                                  weight: weightUnits[val] || 1,
                                  correctAnswer: val === 'pilihan_ganda_kompleks' ? 'A,B' : (val === 'pilihan_ganda' || val === 'listening') ? 'A' : '' 
                                });
                              }}
                              className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800 cursor-pointer"
                            >
                              <option value="pilihan_ganda">Pilihan Ganda</option>
                              <option value="pilihan_ganda_kompleks">Pilihan Ganda Kompleks</option>
                              <option value="listening">Listening</option>
                              <option value="essay">Essay</option>
                            </select>
                          </div>
                          <div className="md:col-span-6">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5 flex flex-wrap items-center">
                              <span>Teks Pertanyaan</span>
                              <span className="ml-1.5 text-[9px] text-amber-600 font-semibold lowercase italic normal-case bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">(Tips: Klik gambar untuk mengubah ukuran)</span>
                            </label>
                            <div className="h-64 mb-12">
                              <RichTextEditor 
                                placeholder="Ketik pertanyaan di sini..."
                                value={editingData.question || ''}
                                onChange={value => setEditingData({ ...editingData, question: value })}
                                className="h-full"
                              />
                            </div>
                          </div>
                          <div className="md:col-span-2">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Bobot Nilai</label>
                            <input 
                              type="number"
                              step="any"
                              min="0"
                              value={editingData.weight !== undefined && editingData.weight !== null ? editingData.weight : ''}
                              onChange={e => {
                                const val = e.target.value;
                                setEditingData({ ...editingData, weight: val === '' ? ('' as any) : parseFloat(val) || 0 });
                              }}
                              className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800"
                            />
                          </div>
                        </div>

                        {editingData.type === 'pilihan_ganda' || editingData.type === 'listening' || editingData.type === 'pilihan_ganda_kompleks' || !editingData.type ? (
                          <>
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                              {['A', 'B', 'C', 'D', 'E'].map(l => (
                                <div key={l} className="space-y-1">
                                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                                    Pilihan {l}
                                  </label>
                                  <div className="flex items-center space-x-1">
                                    <input 
                                      type="text"
                                      value={(editingData as any)[`option${l}`] || ''}
                                      onChange={e => setEditingData({ ...editingData, [`option${l}`]: e.target.value })}
                                      placeholder={`Pilihan ${l}...`}
                                      className="w-full px-2 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                    <button 
                                      type="button"
                                      onClick={() => setEditingData({ ...editingData, [`option${l}`]: '' })}
                                      className="p-1 hover:text-red-500 text-slate-300 transition-colors"
                                      title="Reset Pilihan"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                  {/* Live formula / math preview */}
                                  {(editingData as any)[`option${l}`] && (
                                    <div className="bg-slate-50 rounded border border-slate-200 px-2 py-1 min-h-[26px] text-xs text-slate-800 flex items-center overflow-x-auto shadow-3xs" title="Pratinjau tampilan rumus">
                                      <span className="text-[9px] font-bold text-blue-600 mr-1.5 select-none shrink-0 uppercase tracking-wider">Hasil:</span>
                                      <div 
                                        className="ql-editor p-0 text-xs inline-block [&_p]:m-0 [&_p]:p-0"
                                        dir="auto"
                                        dangerouslySetInnerHTML={{ __html: formatHTML(String((editingData as any)[`option${l}`])) }}
                                      />
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            {editingData.type === 'pilihan_ganda_kompleks' ? (
                              <div>
                                <label className="block text-[10px] font-bold text-teal-700 uppercase mb-1">
                                  Jawaban Benar (Bisa Pilih Lebih Dari 1 Opsi)
                                </label>
                                <div className="flex items-center space-x-4 bg-white p-2 border border-slate-300 rounded w-max">
                                  {['A', 'B', 'C', 'D', 'E'].map(l => {
                                    const isChecked = (editingData.correctAnswer || '').split(',').map(s => s.trim()).includes(l);
                                    return (
                                      <label key={l} className="flex items-center space-x-1.5 cursor-pointer text-xs font-bold text-slate-700 select-none">
                                        <input 
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => setEditingData({ ...editingData, correctAnswer: togglePgkKey(editingData.correctAnswer, l) })}
                                          className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500 cursor-pointer"
                                        />
                                        <span>{l}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                                  Jawaban Benar
                                </label>
                                <select
                                  value={editingData.correctAnswer || 'A'}
                                  onChange={e => setEditingData({ ...editingData, correctAnswer: e.target.value })}
                                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded outline-none font-bold text-slate-700 focus:ring-1 focus:ring-blue-500 cursor-pointer"
                                >
                                  <option value="A">A</option>
                                  <option value="B">B</option>
                                  <option value="C">C</option>
                                  <option value="D">D</option>
                                  <option value="E">E</option>
                                </select>
                              </div>
                            )}
                          </>
                        ) : editingData.type === 'isian_singkat' ? (
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Jawaban Singkat yang Benar</label>
                            <input 
                              type="text"
                              value={editingData.correctAnswer || ''}
                              onChange={e => setEditingData({ ...editingData, correctAnswer: e.target.value })}
                              placeholder="Contoh: Nitrogen"
                              className="w-full max-w-xl px-3 py-2 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800"
                            />
                          </div>
                        ) : (
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Contoh Kunci Jawaban / Pedoman Penilaian (Opsional)</label>
                            <textarea
                              rows={3}
                              value={editingData.correctAnswer || ''}
                              onChange={e => setEditingData({ ...editingData, correctAnswer: e.target.value })}
                              placeholder="Masukkan acuan jawaban benar"
                              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded outline-none focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800"
                            />
                          </div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={q.id} className="p-4 hover:bg-slate-50 transition-colors group relative">
                      <div className="flex items-start space-x-3 mb-2">
                        <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center border border-slate-200 text-slate-500 font-bold text-[10px] shrink-0 mt-0.5">
                           {questions.findIndex(item => item.id === q.id) + 1}
                        </div>
                        <div className="flex-1">
                          <div dir="auto" className="font-semibold text-slate-800 text-sm leading-snug pr-20 py-0 pl-0 ql-editor" dangerouslySetInnerHTML={{ __html: formatHTML(q.question) }} />
                          <div className="flex items-center space-x-2 mt-1.5">
                            {selectedTemplateFilter === 'all' && q.packetName && (
                              <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 font-bold uppercase rounded border border-slate-200">
                                {q.packetName}
                              </span>
                            )}
                            {q.type === 'pilihan_ganda' || !q.type ? (
                              <span className="text-[9px] px-1.5 py-0.5 font-bold uppercase rounded border shadow-3xs bg-blue-100 text-blue-700 border-blue-200">
                                Pilihan Ganda
                              </span>
                            ) : q.type === 'pilihan_ganda_kompleks' ? (
                              <span className="text-[9px] px-1.5 py-0.5 font-bold uppercase rounded border shadow-3xs bg-teal-100 text-teal-700 border-teal-200">
                                PG Kompleks
                              </span>
                            ) : q.type === 'listening' ? (
                              <span className="text-[9px] px-1.5 py-0.5 font-bold uppercase rounded border shadow-3xs bg-sky-100 text-sky-700 border-sky-200">
                                Listening
                              </span>
                            ) : q.type === 'isian_singkat' ? (
                              <span className="text-[9px] px-1.5 py-0.5 font-bold uppercase rounded border shadow-3xs bg-amber-100 text-amber-700 border-amber-200">
                                Isian Singkat
                              </span>
                            ) : (
                              <span className="text-[9px] px-1.5 py-0.5 font-bold uppercase rounded border shadow-3xs bg-purple-100 text-purple-700 border-purple-200">
                                Essay
                              </span>
                            )}
                            <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 font-bold uppercase rounded border border-slate-200">
                              Bobot: {q.weight !== undefined ? Number(q.weight).toFixed(2).replace(/\.00$/, '') : '1'}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      {(q.type === 'pilihan_ganda' || !q.type || q.type === 'listening' || q.type === 'pilihan_ganda_kompleks') ? (
                        <div className="pl-9 grid grid-cols-1 sm:grid-cols-2 text-[11px] gap-x-4">
                          {['A', 'B', 'C', 'D', 'E'].map((opt) => {
                            const key = `option${opt}` as keyof Question;
                            const val = q[key];
                            if (isOptionEmpty(val)) return null;
                            const correctKeys = (q.correctAnswer || '').split(',').map(s => s.trim().toUpperCase());
                            const isCorrect = q.type === 'pilihan_ganda_kompleks' ? correctKeys.includes(opt) : q.correctAnswer === opt;
                            
                            return (
                              <div 
                                key={opt} 
                                className={`flex items-baseline gap-2 px-2 py-1.5 rounded-lg border transition-all ${
                                  isCorrect 
                                    ? 'bg-green-50/70 border-green-200/80 font-bold text-green-700 shadow-3xs' 
                                    : 'border-transparent text-slate-600 hover:bg-slate-50/50'
                                }`}
                              >
                                <span className={`shrink-0 select-none font-bold text-[11px] ${isCorrect ? 'text-green-600' : 'text-slate-400'}`}>
                                  {opt}.
                                </span>
                                <div 
                                  className="ql-editor p-0 text-[11px] flex-1 leading-normal text-left [&_p]:m-0 [&_p]:p-0" 
                                  dir="auto"
                                  dangerouslySetInnerHTML={{ __html: formatHTML(String(val)) }} 
                                />
                              </div>
                            );
                          })}
                        </div>
                      ) : q.type === 'isian_singkat' ? (
                        <div className="pl-9 text-xs text-slate-600 flex items-center space-x-2">
                          <span className="inline-block font-extrabold text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-100 text-[10px] uppercase">Kunci Isian:</span>
                          <span className="bg-slate-50 px-2.5 py-1 rounded border border-slate-150 font-mono font-bold text-slate-800 text-[11px]">{q.correctAnswer || '-'}</span>
                        </div>
                      ) : (
                        <div className="pl-9 text-xs text-slate-600">
                          <span className="inline-block font-extrabold text-purple-700 bg-purple-50 px-2 py-1 rounded border border-purple-100 text-[10px] uppercase">Contoh Kunci Jawaban / Pedoman:</span>
                          <p className="mt-1 bg-slate-50/50 p-2.5 rounded border border-slate-100 shadow-3xs leading-relaxed text-slate-700 font-semibold">{q.correctAnswer || '-'}</p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="absolute top-3.5 right-3.5 flex items-center space-x-1.5 bg-white/95 px-2 py-1 rounded-md border border-slate-200 shadow-2xs">
                        <button 
                          type="button"
                          onClick={() => startEditing(q)}
                          className="px-2 py-1 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded bg-white border border-slate-200 transition-colors flex items-center gap-1 text-[11px] font-semibold cursor-pointer" 
                          title="Edit Soal Ini"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Edit</span>
                        </button>
                        <button 
                          type="button"
                          onClick={() => handleDeleteQuestion(q.id!)}
                          className="px-2 py-1 text-red-600 hover:text-white hover:bg-red-600 rounded bg-red-50 hover:border-red-600 border border-red-200 transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer" 
                          title={`Hapus Soal Nomor ${questions.findIndex(item => item.id === q.id) + 1}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Hapus</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reusable modal confirmation overlay */}
      {modalConfig && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 transition-all duration-200">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-md w-full overflow-hidden transform scale-100 transition-all animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5">
              <h3 className={`text-base font-bold ${modalConfig.isDanger ? 'text-red-600' : 'text-slate-800'} mb-2`}>
                {modalConfig.title}
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                {modalConfig.description}
              </p>

              {/* Body for Prompt */}
              {modalConfig.type === 'prompt' && (
                <input
                  type="text"
                  value={modalConfig.inputValue || ''}
                  onChange={e => setModalConfig({ ...modalConfig, inputValue: e.target.value })}
                  placeholder={modalConfig.placeholder}
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm outline-none focus:ring-1 focus:ring-blue-500 mb-2 bg-slate-50 font-medium"
                  autoFocus
                />
              )}

              {modalConfig.type === 'delete-all' && (
                <div className="space-y-3 mb-2">
                  <p className="text-[10px] font-bold text-red-500 bg-red-50 p-2 rounded border border-red-100 uppercase">
                    Ketik "{modalConfig.validationWord}" di bawah untuk mengonfirmasi:
                  </p>
                  <input
                    type="text"
                    value={modalConfig.inputValue || ''}
                    onChange={e => setModalConfig({ ...modalConfig, inputValue: e.target.value })}
                    placeholder={`Ketik ${modalConfig.validationWord}`}
                    className="w-full px-3 py-2 border border-red-200 text-red-700 bg-red-50/30 rounded text-sm outline-none font-bold placeholder:font-normal placeholder:text-slate-400 focus:ring-1 focus:ring-red-500"
                    autoFocus
                  />
                </div>
              )}
            </div>

            <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex items-center justify-end space-x-2">
              {modalConfig.type !== 'alert' && (
                <button
                  type="button"
                  onClick={() => {
                    if (modalConfig.onCancel) modalConfig.onCancel();
                    setModalConfig(null);
                  }}
                  className="px-3.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-600 rounded text-xs font-semibold cursor-pointer transition shadow-xs"
                >
                  Batal
                </button>
              )}
              <button
                type="button"
                disabled={
                  (modalConfig.type === 'delete-all' && modalConfig.inputValue !== modalConfig.validationWord) ||
                  (modalConfig.type === 'prompt' && !modalConfig.inputValue?.trim())
                }
                onClick={async () => {
                  const onConf = modalConfig.onConfirm;
                  const inputVal = modalConfig.inputValue || '';
                  setModalConfig(null);
                  if (onConf) {
                    await onConf(inputVal);
                  }
                }}
                className={`px-3.5 py-1.5 rounded text-xs font-bold uppercase transition shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  modalConfig.isDanger 
                    ? 'bg-red-600 hover:bg-red-700 text-white' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {modalConfig.confirmText || 'Konfirmasi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
