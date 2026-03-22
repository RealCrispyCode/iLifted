import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import type { VercelRequest, VercelResponse } from '@vercel/node';

function buildComparisonPrompt(weight: number, unit: string, category: string): string {
  const low = Math.round(Number(weight) * 0.7);
  const high = Math.round(Number(weight) * 1.3);
  const isSurprise = category === 'surprise me';

  const categoryInstruction = isSurprise
    ? `Pick something genuinely surprising or unexpected — obscure, counterintuitive, or the kind of thing that makes someone say "I had no idea that weighed that much". Avoid generic animals or common household objects.`
    : `Pick something from the category "${category}" that feels apt, interesting, or memorable for this weight. Stay on brief — the category was chosen deliberately.`;

  return `The user lifted ${weight} ${unit}.
Find ONE real-world item that weighs APPROXIMATELY ${weight} ${unit} — it MUST weigh between ${low} ${unit} and ${high} ${unit}. Do not suggest anything that weighs a fraction of this.
${categoryInstruction}
The comparison should be interesting and shareable. It can be funny if that fits naturally, but the primary goal is that it's genuinely surprising or satisfying to learn. Accuracy matters — the weight match must be real.
Return ONLY valid JSON with no markdown or explanation:
{"message": "Celebratory message to the user referencing the comparison", "shortDescription": "Item name only", "imagePrompt": "Detailed visual prompt for image generation", "objectTag": "single word tag", "items": ["item name"]}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { weight, unit, category } = req.body;
  let retryDelaySec: number | null = null;
  const customKey = process.env.CUSTOM_GEMINI_KEY;
  const defaultKey = process.env.GEMINI_API_KEY;
  const apiKey = customKey || defaultKey;

  console.log(`Comparison Request: ${weight}${unit} - Key Source: ${customKey ? 'CUSTOM_SECRET' : 'DEFAULT_MANAGED'}`);

  if (!apiKey) {
    return res.status(200).json({ error: 'No API key configured', fallback: true });
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildComparisonPrompt(Number(weight), unit, category);

  // --- Attempt 1: Gemini ---
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
            items: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["message", "shortDescription", "imagePrompt", "objectTag", "items"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return res.status(200).json(result);
  } catch (error: any) {
    let errorMessage = error.message;
    try {
      const parsed = JSON.parse(error.message);
      errorMessage = parsed.error?.message || error.message;
    } catch (e) {}

    console.error("Gemini Error:", errorMessage);

    const isInvalidKey = errorMessage?.toLowerCase().includes('api key not valid') ||
                         errorMessage?.toLowerCase().includes('invalid_argument') ||
                         errorMessage?.toLowerCase().includes('400');

    if (isInvalidKey) {
      return res.status(200).json({ error: 'INVALID_KEY', fallback: true });
    }

    const retryDelayMatch = errorMessage?.match(/retry in (\d+(?:\.\d+)?)s/i);
    retryDelaySec = retryDelayMatch ? Math.ceil(parseFloat(retryDelayMatch[1])) : null;
    console.warn(`Gemini quota/error hit (retry in ${retryDelaySec}s), trying OpenRouter fallback...`);
  }

  // --- Attempt 2: OpenRouter ---
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    try {
      const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ilifted.vercel.app',
          'X-Title': 'iLifted'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        })
      });

      if (orResponse.ok) {
        const orData = await orResponse.json();
        const content = orData.choices?.[0]?.message?.content;
        if (content) {
          const firstBrace = content.indexOf('{');
          const lastBrace = content.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
            if (parsed.message && parsed.shortDescription) {
              console.log("OpenRouter fallback succeeded.");
              return res.status(200).json({ ...parsed, fallbackProvider: 'openrouter' });
            }
          }
        }
      } else {
        console.warn(`OpenRouter returned ${orResponse.status}`);
      }
    } catch (orError: any) {
      console.warn("OpenRouter fallback failed:", orError.message);
    }
  } else {
    console.warn("OPENROUTER_API_KEY not set, skipping OpenRouter fallback.");
  }

  // --- All server-side attempts exhausted ---
  return res.status(200).json({
    error: 'QUOTA_EXCEEDED',
    fallback: true,
    retryDelay: retryDelaySec ? retryDelaySec * 1000 : null
  });
}
