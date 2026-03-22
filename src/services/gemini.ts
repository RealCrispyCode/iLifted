export interface ComparisonResult {
  message: string;
  shortDescription: string;
  imagePrompt: string;
  objectTag: string;
  items: string[];
}

export async function getWeightComparison(weight: number, unit: string, category: string): Promise<ComparisonResult> {
  try {
    const response = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weight, unit, category })
    });

    if (response.ok) {
      return await response.json();
    }
    
    const errorData = await response.json();
    console.warn("Vercel API error:", errorData.error);
  } catch (err) {
    console.warn("Vercel API call failed, jumping to fallback");
  }

  return await getWeightComparisonFallback(weight, unit, category);
}

async function getWeightComparisonFallback(weight: number, unit: string, category: string): Promise<ComparisonResult> {
  console.warn("Entering Fallback Mode...");
  
  const prompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${category}. Return ONLY JSON: {"message": "msg", "shortDescription": "item", "imagePrompt": "prompt", "objectTag": "tag", "items": ["item"]}`;

  // Try multiple models via GET (more robust for CORS/Vercel)
  const models = ['openai', 'mistral', 'searchgpt'];
  
  for (const model of models) {
    try {
      const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&json=true&seed=${Math.floor(Math.random() * 1000000)}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout per model
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) continue;
      const text = await response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      
      const parsed = JSON.parse(jsonMatch[0]) as ComparisonResult;
      if (parsed.message && parsed.shortDescription) return parsed;
    } catch (error) {
      console.warn(`Fallback model ${model} failed:`, error);
    }
  }
  
  // If we reach here, all AI models (Gemini + Fallbacks) have failed
  console.error("All AI models failed to respond.");
  throw new Error("QUOTA_EXCEEDED_DAY");
}

async function generatePollinationsImage(prompt: string): Promise<string> {
  const cleanPrompt = prompt.replace(/["']/g, '').trim();
  const enhancedPrompt = `A premium photorealistic studio shot of: ${cleanPrompt}. Centered, square composition, professional lighting, sharp focus. No text.`;
  
  // Return the URL directly. The browser's <img> tag is more resilient than fetch() for images.
  // We add a random seed to bypass any cached "error" images.
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}&model=flux`;
}

export async function generateComparisonImage(prompt: string): Promise<string> {
  let lastError: any = null;

  // Try Gemini via Vercel Function first (Higher quality)
  try {
    const response = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    if (response.ok) {
      const data = await response.json();
      return data.image;
    }
    
    const errorData = await response.json();
    throw new Error(errorData.error || "Vercel API error");
  } catch (error: any) {
    console.warn("Gemini image generation failed or blocked, switching to Pollinations fallback:", error.message);
    lastError = error;
  }
  
  // Fallback to Pollinations (Always available)
  try {
    return await generatePollinationsImage(prompt);
  } catch (fallbackError) {
    console.error("Fallback also failed:", fallbackError);
    const errorMessage = (lastError?.message || "").toLowerCase();
    if (errorMessage.includes("exhausted") || errorMessage.includes("daily")) {
      throw new Error("QUOTA_EXCEEDED_DAY");
    }
    throw new Error("QUOTA_EXCEEDED_MINUTE");
  }
}
