import { GoogleGenAI } from "@google/genai";
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured on Vercel' });
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [{ text: `A premium yet playful, high-quality photorealistic studio shot of: ${prompt}. The image should have a centered, square composition with a subtle gym or weightlifting flavor, using professional lighting and sharp focus. Feel free to be playful with the background, incorporating fitness-themed elements in visually engaging ways to give the subject an athletic presence. No text.` }]
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        }
      }
    });

    const candidate = response.candidates?.[0];
    if (candidate?.finishReason === 'SAFETY') {
      return res.status(400).json({ error: 'SAFETY_BLOCKED' });
    }

    for (const part of candidate?.content?.parts || []) {
      if (part.inlineData) {
        return res.status(200).json({ image: `data:image/png;base64,${part.inlineData.data}` });
      }
    }
    
    return res.status(500).json({ error: 'No image data generated' });
  } catch (error: any) {
    console.error("Gemini Image Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
