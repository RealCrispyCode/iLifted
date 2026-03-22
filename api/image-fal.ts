import type { VercelRequest, VercelResponse } from '@vercel/node';

// Model is hardcoded to flux/schnell — $0.003/image (1MP).
// Do NOT change this to flux/dev or any other model without reviewing pricing first.
const FAL_MODEL = 'fal-ai/flux/schnell';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const falKey = process.env.FAL_API_KEY;
  if (!falKey) {
    return res.status(200).json({ error: 'FAL_API_KEY not configured', fallback: true });
  }

  console.log(`Image Request (fal.ai ${FAL_MODEL})`);

  try {
    const response = await fetch(`https://fal.run/${FAL_MODEL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        image_size: 'square_hd',   // 1024x1024 = 1MP = $0.003
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: true
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`fal.ai failed: ${response.status}`, errorBody);
      return res.status(200).json({ error: `fal.ai returned ${response.status}`, fallback: true });
    }

    const data = await response.json();
    const imageUrl = data.images?.[0]?.url;

    if (!imageUrl) {
      console.error("fal.ai returned no image URL:", JSON.stringify(data));
      return res.status(200).json({ error: 'fal.ai returned no image URL', fallback: true });
    }

    // Fetch the image and return as base64 so the client never needs the fal.ai CDN URL
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return res.status(200).json({ error: 'Failed to fetch fal.ai image from CDN', fallback: true });
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString('base64');
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    console.log(`fal.ai (${FAL_MODEL}) succeeded.`);
    return res.status(200).json({ image: `data:${contentType};base64,${base64}` });

  } catch (error: any) {
    console.error("fal.ai handler error:", error.message);
    return res.status(200).json({ error: error.message, fallback: true });
  }
}
