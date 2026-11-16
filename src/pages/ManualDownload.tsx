import React, { useState } from 'react';
import { Download, FileText, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
// @ts-ignore
import htmlDocx from 'html-docx-js/dist/html-docx';

export default function ManualDownload() {
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);

  const manualHtmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Buku Panduan Penggunaan ExamProPlus</title>
      <style>
        body { font-family: 'Arial', sans-serif; line-height: 1.6; color: #333; margin: 40px; }
        h1 { color: #1e3a8a; text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; }
        h2 { color: #2563eb; margin-top: 30px; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; }
        h3 { color: #334155; margin-top: 20px; }
        p, li { font-size: 11pt; text-align: justify; }
        ul { margin-bottom: 15px; }
        .highlight { background-color: #f1f5f9; padding: 10px; border-left: 4px solid #2563eb; margin: 10px 0; }
      </style>
    </head>
    <body>
      <h1>BUKU PANDUAN PENGGUNAAN APLIKASI EXAMPROPLUS</h1>
      <p style="text-align: center; font-style: italic; color: #64748b;">Sistem Ujian Online (CBT) Berbasis Web yang Aman, Handal, dan Profesional</p>

      <h2>BAB I: PENGENALAN & FITUR UTAMA EXAMPROPLUS</h2>
      <p>ExamProPlus adalah platform Computer-Based Test (CBT) berbasis web yang dirancang khusus untuk memudahkan instansi pendidikan dalam mengelola ujian online secara aman, terstruktur, dan real-time.</p>
      
      <h3>Fitur-Fitur Unggulan:</h3>
      <ul>
        <li><strong>Kartu Peserta Ujian & Foto Siswa:</strong> Setiap siswa memiliki kartu ujian resmi yang memuat identitas, kelas, link portal, dan foto siswa yang tampil secara real-time di layar pengawas dan pojok header layar ujian.</li>
        <li><strong>Audio Listening Fleksibel:</strong> Mendukung audio umum (Audio Bank) maupun audio spesifik per nomor soal.</li>
        <li><strong>Dukungan Rumus Sains:</strong> Mendukung perenderan rumus matematika, fisika, dan kimia (LaTeX/KaTeX) dengan rapi.</li>
        <li><strong>Catatan Teks Arab:</strong> Mendukung teks standar; untuk teks Arab berharakat penuh disarankan menggunakan gambar/screenshot.</li>
        <li><strong>Keamanan Berlapis:</strong> Masuk ujian wajib menggunakan Token dari Guru, dilengkapi opsi Password/PIN Siswa, serta mode Fullscreen anti-pindah tab.</li>
      </ul>

      <h2>BAB II: PANDUAN MENU UTAMA ADMIN / GURU</h2>
      <p>Berikut adalah penjelasan 9 menu utama pada panel admin:</p>
      
      <h3>1. Dashboard</h3>
      <p>Pusat kendali utama yang merangkum statistik ujian aktif, total mata pelajaran, kelas terdaftar, dan jalan pintas cepat.</p>

      <h3>2. Manajemen Ujian</h3>
      <p>Menu untuk menjadwalkan dan mengontrol sesi ujian. Atur nama ujian, kelas, mata pelajaran, paket tunggal atau multi-paket acak (Round-Robin / Acak Murni), durasi, token ujian otomatis, dan batas pelanggaran.</p>

      <h3>3. Manajemen Kelas</h3>
      <p>Mengelola rombongan belajar dan daftar siswa lengkap dengan foto profil, PIN/Password Siswa, serta pencetakan Kartu Ujian.</p>

      <h3>4. Manajemen Soal (Bank Soal & Template)</h3>
      <p>Mengunggah file soal Word (.docx), input manual, mendukung editor rumus sains, serta penyesuaian bobot otomatis total 100.</p>

      <h3>5. Manajemen Audio</h3>
      <p>Tempat mengunggah dan mengelola arsip file MP3/WAV untuk ujian listening.</p>

      <h3>6. Mata Pelajaran</h3>
      <p>Mendaftarkan bidang studi sekolah yang terikat eksklusif pada akun admin yang login.</p>

      <h3>7. Monitoring Peserta</h3>
      <p>Pengawasan real-time jalannya ujian: memantau status Mengerjakan, Terputus, Melanggar, Selesai, melihat foto siswa, mengubah durasi, mendiskualifikasi, atau memberikan Restorasi Akses.</p>

      <h3>8. Hasil Ujian</h3>
      <p>Rekapitulasi nilai akhir, koreksi manual soal essay, serta ekspor data ke Excel (.xlsx).</p>

      <h3>9. Pengaturan</h3>
      <p>Mengatur identitas sekolah, logo, nama guru/proktor, dan aturan pelanggaran default.</p>

      <h2>BAB III: PANDUAN MENGERJAKAN UJIAN UNTUK SISWA</h2>
      <ol>
        <li>Buka browser melalui link portal atau scan QR pada Kartu Ujian Siswa.</li>
        <li>Masukkan <strong>Token Ujian 6 digit</strong> dari pengawas.</li>
        <li>Pilih nama siswa dari daftar kelas.</li>
        <li>Masukkan <strong>Password / PIN Siswa</strong> pribadi (jika diwajibkan oleh guru).</li>
        <li>Masuk ke Mode Layar Penuh (Fullscreen) dan mulai mengerjakan soal dengan tenang karena jawaban otomatis tersimpan secara real-time.</li>
      </ol>
    </body>
    </html>
  `;

  const handleDownload = () => {
    setDownloading(true);
    try {
      const converted = htmlDocx.asBlob(manualHtmlContent);
      const url = URL.createObjectURL(converted);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Buku_Panduan_ExamProPlus.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Gagal mengunduh dokumen Word.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-12 flex flex-col items-center justify-center font-sans">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-blue-100 shadow-sm">
          <FileText className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-800 uppercase tracking-wide mb-2">Buku Panduan ExamProPlus</h1>
        <p className="text-xs text-slate-500 mb-8 leading-relaxed font-medium">
          Dokumen panduan lengkap mencakup penjelasan 9 menu utama, fitur unggulan (Kartu siswa, foto, listening, rumus sains, teks Arab), hingga tata cara login siswa menggunakan token & password.
        </p>

        <div className="space-y-3">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>{downloading ? 'Memproses Dokumen...' : 'Unduh Dokumen (.docx)'}</span>
          </button>

          <button
            onClick={() => navigate(-1)}
            className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali</span>
          </button>
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-emerald-600 font-bold">
          <CheckCircle2 className="w-4 h-4" />
          <span>Format Microsoft Word Kompatibel (MS Word / WPS / Google Docs)</span>
        </div>
      </div>
    </div>
  );
}
