import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { weight, unit, category } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured on Vercel' });
  }

  const ai = new GoogleGenAI({ apiKey });
  const isSurprise = category === 'surprise me';
  const categoryPrompt = isSurprise 
    ? "ANYTHING AT ALL (weird, obscure, unexpected). AVOID generic animals."
    : `the category "${category}"`;

  const prompt = `The user lifted ${weight} ${unit}. 
  Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in ${categoryPrompt}.
  Return ONLY a JSON object:
  {
    "message": "Celebratory message to user",
    "shortDescription": "Item name only",
    "imagePrompt": "Detailed visual prompt",
    "objectTag": "tag",
    "items": ["item"]
  }`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            message: { type: Type.STRING },
            shortDescription: { type: Type.STRING },
            imagePrompt: { type: Type.STRING },
            objectTag: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["message", "shortDescription", "imagePrompt", "objectTag", "items"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return res.status(200).json(result);
  } catch (error: any) {
    console.error("Gemini Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
