import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ComparisonResult {
  message: string;
  shortDescription: string;
  imagePrompt: string;
  items: string[];
}

export async function getWeightComparison(weight: number, unit: string, category: string): Promise<ComparisonResult> {
  const prompt = `The user just lifted ${weight} ${unit}. 
  Provide a funny and interesting comparison of ONE SINGLE item that weighs AT MOST ${weight} ${unit} in the category "${category}".
  
  CRITICAL RULES:
  1. You MUST only use ONE single item. Do not add multiple items or fractions.
  2. The item's weight MUST NOT exceed ${weight} ${unit}. It should be as close as possible but under or equal to the limit.
  3. Be creative and funny with the object choice.
  4. Be fast and concise.
  
  Return a JSON object with:
  - "message": A punchy, celebratory message in the first person (bragging tone) like "I just lifted the equivalent of a fully grown giant panda!"
  - "shortDescription": A very short summary, e.g., "a giant panda".
  - "imagePrompt": A detailed prompt for an image generator showing the item.
  - "items": A list containing only that one item.`;

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
          items: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["message", "shortDescription", "imagePrompt", "items"]
      }
    }
  });

  return JSON.parse(response.text || "{}") as ComparisonResult;
}

export async function generateComparisonImage(prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [{ text: `A high-quality, photorealistic studio shot of: ${prompt}. Professional product photography, clean solid light gray background, sharp focus, natural lighting, highly detailed, 8k resolution, no text.` }]
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
      }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  
  throw new Error("Failed to generate image");
}
