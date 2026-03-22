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
    console.warn("Pollinations server-side failed on all models, trying Mistral...");
  } else {
    console.warn("POLLINATIONS_SECRET_KEY not set, skipping Pollinations server-side.");
  }

  // --- Attempt 2: Mistral (authenticated per key, reliable free tier) ---
  const mistralKey = process.env.MISTRAL_API_KEY;
  if (mistralKey) {
    const mistralPrompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${category}. Return ONLY valid JSON with no markdown or explanation: {"message": "Celebratory message", "shortDescription": "Item name only", "imagePrompt": "Detailed visual prompt", "objectTag": "tag", "items": ["item"]}`;

    try {
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mistralKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{ role: 'user', content: mistralPrompt }],
          response_format: { type: 'json_object' },
          temperature: 0.7
        }),
        signal: AbortSignal.timeout(15000)
      });

      console.log(`Mistral status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          const firstBrace = content.indexOf('{');
          const lastBrace = content.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            try {
              const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
              if (parsed.message && parsed.shortDescription) {
                console.log("text-fallback succeeded via Mistral.");
                return res.status(200).json({ ...parsed, fallbackProvider: 'mistral' });
              }
              console.warn("Mistral parsed OK but missing required fields. Keys:", Object.keys(parsed).join(', '));
            } catch (parseErr) {
              console.warn("Failed to parse JSON from Mistral:", content.substring(0, 200));
            }
          }
        } else {
          console.warn("Mistral returned no content");
        }
      } else {
        const errBody = await response.text();
        console.warn(`Mistral error ${response.status}:`, errBody.substring(0, 200));
      }
    } catch (err: any) {
      console.warn("Mistral threw:", err.message);
    }
    console.warn("Mistral failed, trying OpenRouter...");
  } else {
    console.warn("MISTRAL_API_KEY not set, skipping Mistral.");
  }

  // --- Attempt 3: OpenRouter (last resort) ---
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    console.error("No fallback keys produced a result");
    return res.status(200).json({ error: 'All fallback models failed', fallback: true });
  }

  const orPrompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${category}. Return ONLY valid JSON with no markdown or explanation: {"message": "Celebratory message", "shortDescription": "Item name only", "imagePrompt": "Detailed visual prompt", "objectTag": "tag", "items": ["item"]}`;

  const orModels = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'google/gemma-3-12b-it:free'
  ];

  for (const model of orModels) {
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
      if (!content) continue;

      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1) continue;

      try {
        const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
        if (parsed.message && parsed.shortDescription) {
          console.log(`text-fallback succeeded via OpenRouter ${model}.`);
          return res.status(200).json({ ...parsed, fallbackProvider: 'openrouter' });
        }
      } catch (parseErr) {
        console.warn(`Failed to parse JSON from OpenRouter ${model}`);
      }
    } catch (err: any) {
      console.warn(`OpenRouter ${model} threw:`, err.message);
    }
  }

  console.error("All fallbacks exhausted in text-fallback");
  return res.status(200).json({ error: 'All fallback models failed', fallback: true });
}
