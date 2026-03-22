import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { weight, unit, category } = req.body;
  if (!weight || !unit || !category) {
    return res.status(400).json({ error: 'weight, unit, and category are required' });
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    return res.status(200).json({ error: 'OPENROUTER_API_KEY not configured', fallback: true });
  }

  const prompt = `The user lifted ${weight} ${unit}. Provide a funny comparison of ONE item weighing AT MOST ${weight} ${unit} in category ${category}. Return ONLY valid JSON with no markdown or explanation: {"message": "Celebratory message", "shortDescription": "Item name only", "imagePrompt": "Detailed visual prompt", "objectTag": "tag", "items": ["item"]}`;

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
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        console.warn(`OpenRouter model ${model} returned ${response.status}`);
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
          console.log(`Text fallback succeeded via OpenRouter ${model}.`);
          return res.status(200).json({ ...parsed, fallbackProvider: 'openrouter-client' });
        }
      } catch (parseErr) {
        console.warn(`Failed to parse JSON from OpenRouter ${model}`);
      }
    } catch (err: any) {
      console.warn(`OpenRouter model ${model} failed:`, err.message);
    }
  }

  return res.status(200).json({ error: 'All OpenRouter models failed', fallback: true });
}
