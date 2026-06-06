import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialize Gemini
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // API Routes
  app.get("/api/ai/health", (req, res) => {
    res.json({ 
      status: "ok", 
      env: process.env.NODE_ENV,
      hasKey: !!process.env.GEMINI_API_KEY 
    });
  });

  app.post("/api/ai/grade", async (req, res) => {
    try {
      const { question, studentAnswer, referenceAnswer, type } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY tidak ditemukan di environment. Silakan cek Settings > Secrets." });
      }

      if (!question || !studentAnswer) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const systemInstruction = `
        Anda adalah asisten guru yang ahli dalam mengoreksi jawaban siswa.
        Tugas Anda adalah menilai jawaban siswa berdasarkan pertanyaan dan kunci jawaban (jika ada).
        Berikan skor antara 0 sampai 1.
        0 = Sangat salah / tidak ada jawaban yang relevan.
        1 = Sangat akurat dan lengkap sesuai dengan maksud pertanyaan.
        
        Gunakan logika berikut:
        - Untuk 'isian_singkat': Nilai harus ketat (1 jika cocok secara makna, 0 jika jauh berbeda). 
        - Untuk 'essay': Nilai lebih fleksibel (bobot diberikan berdasarkan seberapa banyak poin yang tersampaikan).
        
        Berikan respon dalam format JSON:
        {
          "score": number (0-1),
          "feedback": string (penjelasan singkat mengapa skor tersebut diberikan dalam Bahasa Indonesia)
        }
      `;

      const prompt = `
        Tipe Soal: ${type}
        Pertanyaan: ${question}
        Kunci Jawaban Referensi: ${referenceAnswer || "Tidak ada referensi spesifik"}
        Jawaban Siswa: ${studentAnswer}
        
        Tolong nilai jawaban tersebut.
      `;

      const result = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              feedback: { type: Type.STRING },
            },
            required: ["score", "feedback"],
          },
        }
      });

      const responseText = result.text;
      if (!responseText) {
        throw new Error("Tidak ada respon dari AI");
      }
      const grading = JSON.parse(responseText);

      res.json(grading);
    } catch (error: any) {
      console.error("AI Grading Error:", error);
      res.status(500).json({ error: "Gagal melakukan koreksi AI", details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
