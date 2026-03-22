import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { weight, unit, category } = req.body;
  if (!weight || !unit || !category) {
    return res.status(400).json({ error: 'weight, unit, and category are required' });
  }

  const prompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${category}. Return ONLY a JSON object: {"message": "msg", "shortDescription": "item", "imagePrompt": "prompt", "objectTag": "tag", "items": ["item"]}`;

  // --- Attempt 1: Pollinations server-side with secret key (no rate limit) ---
  const pollinationsKey = process.env.POLLINATIONS_SECRET_KEY;
  if (pollinationsKey) {
    const pollinationsModels = ['openai', 'mistral'];
    for (const model of pollinationsModels) {
      try {
        const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?model=${model}&json=true&seed=${Math.floor(Math.random() * 1000000)}`;
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${pollinationsKey}` },
          signal: AbortSignal.timeout(12000)
        });

        console.log(`Pollinations server ${model} status: ${response.status}`);

        if (response.status === 429 || response.status === 502 || response.status === 503) {
          console.warn(`Pollinations server ${model} unavailable (${response.status})`);
          continue;
        }
        if (!response.ok) continue;

        const text = await response.text();
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1) continue;

        try {
          const parsed = JSON.parse(text.substring(firstBrace, lastBrace + 1));
          if (parsed.message && parsed.shortDescription) {
            console.log(`text-fallback succeeded via Pollinations server-side ${model}.`);
            return res.status(200).json({ ...parsed, fallbackProvider: 'pollinations-server' });
          }
        } catch (parseErr) {
          console.warn(`Failed to parse JSON from Pollinations server ${model}`);
        }
      } catch (err: any) {
        console.warn(`Pollinations server ${model} threw:`, err.message);
      }
    }
    console.warn("Pollinations server-side failed on all models, trying OpenRouter...");
  } else {
    console.warn("POLLINATIONS_SECRET_KEY not set, skipping Pollinations server-side.");
  }

  // --- Attempt 2: OpenRouter ---
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    console.warn("OPENROUTER_API_KEY not set");
    return res.status(200).json({ error: 'No fallback keys configured', fallback: true });
  }

  const orPrompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${category}. Return ONLY valid JSON with no markdown or explanation: {"message": "Celebratory message", "shortDescription": "Item name only", "imagePrompt": "Detailed visual prompt", "objectTag": "tag", "items": ["item"]}`;

  const models = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'google/gemma-3-12b-it:free'
  ];

  for (const model of models) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ilifted.vercel.app',
          'X-Title': 'iLifted'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: orPrompt }],
          response_format: { type: 'json_object' }
        }),
        signal: AbortSignal.timeout(15000)
      });

      console.log(`OpenRouter ${model} status: ${response.status}`);

      if (!response.ok) {
        const errBody = await response.text();
        console.warn(`OpenRouter ${model} error:`, errBody.substring(0, 200));
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.warn(`OpenRouter ${model} returned no content`);
        continue;
      }

      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1) continue;

      try {
        const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
        console.log(`OpenRouter ${model} parsed keys:`, Object.keys(parsed).join(', '));
        if (parsed.message && parsed.shortDescription) {
          console.log(`text-fallback succeeded via OpenRouter ${model}.`);
          return res.status(200).json({ ...parsed, fallbackProvider: 'openrouter' });
        }
        console.warn(`OpenRouter ${model} missing required fields. Keys: ${Object.keys(parsed).join(', ')}`);
      } catch (parseErr) {
        console.warn(`Failed to parse JSON from OpenRouter ${model}:`, content.substring(0, 200));
      }
    } catch (err: any) {
      console.warn(`OpenRouter ${model} threw:`, err.message);
    }
  }

  console.error("All fallbacks failed in text-fallback");
  return res.status(200).json({ error: 'All fallback models failed', fallback: true });
}
