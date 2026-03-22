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
    console.warn("OPENROUTER_API_KEY not set");
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

      console.log(`OpenRouter ${model} status: ${response.status}`);

      if (!response.ok) {
        const errBody = await response.text();
        console.warn(`OpenRouter ${model} error body:`, errBody.substring(0, 200));
        continue;
      }

      const data = await response.json();
      console.log(`OpenRouter ${model} raw response:`, JSON.stringify(data).substring(0, 300));

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.warn(`OpenRouter ${model} returned no content. Full response:`, JSON.stringify(data).substring(0, 300));
        continue;
      }

      console.log(`OpenRouter ${model} content:`, content.substring(0, 200));

      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1) {
        console.warn(`OpenRouter ${model} content has no JSON braces`);
        continue;
      }

      try {
        const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
        console.log(`OpenRouter ${model} parsed keys:`, Object.keys(parsed).join(', '));
        if (parsed.message && parsed.shortDescription) {
          console.log(`Text fallback succeeded via OpenRouter ${model}.`);
          return res.status(200).json({ ...parsed, fallbackProvider: 'openrouter-client' });
        }
        console.warn(`OpenRouter ${model} parsed OK but missing required fields. Keys: ${Object.keys(parsed).join(', ')}`);
      } catch (parseErr) {
        console.warn(`Failed to parse JSON from OpenRouter ${model}:`, content.substring(0, 200));
      }
    } catch (err: any) {
      console.warn(`OpenRouter model ${model} threw:`, err.message);
    }
  }

  console.error("All OpenRouter models failed in text-fallback");
  return res.status(200).json({ error: 'All OpenRouter models failed', fallback: true });
}
