// Vercel serverless function: sends the user's sentence to Google Gemini (free tier) with tool definitions.
// Needs env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

const str = { type: 'STRING' };

const functionDeclarations = [
  {
    name: 'add_contact',
    description: 'Add a new contact with a name and phone number.',
    parameters: { type: 'OBJECT', properties: { name: str, phone: str }, required: ['name', 'phone'] },
  },
  {
    name: 'update_contact',
    description: 'Change the phone number and/or name of an existing contact.',
    parameters: {
      type: 'OBJECT',
      properties: { name: str, new_phone: str, new_name: str },
      required: ['name'],
    },
  },
  {
    name: 'delete_contact',
    description: 'Delete an existing contact by name.',
    parameters: { type: 'OBJECT', properties: { name: str }, required: ['name'] },
  },
  {
    name: 'clarify',
    description: 'Use when the request is unclear, missing a name or number, or not about contacts.',
    parameters: { type: 'OBJECT', properties: { question: str }, required: ['question'] },
  },
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  try {
    // Only logged-in users may use the AI
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const who = token && (await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    }));
    if (!who || !who.ok) return res.status(401).json({ error: 'Please log in again.' });

    const { text, contacts = [] } = req.body || {};
    if (typeof text !== 'string' || !text.trim() || text.length > 300) {
      return res.status(400).json({ error: 'Type a short instruction (up to 300 characters).' });
    }

    const list = JSON.stringify(contacts.slice(0, 200).map((c) => ({ name: c.name, phone: c.phone })));
    const system =
      'You manage a phone book by calling tools. Call one tool per requested change. ' +
      'The user may write in English, Urdu or Hinglish. ' +
      'For update/delete, use the exact name of the matching existing contact from this list (case-insensitive match is fine). ' +
      'Keep phone numbers exactly as the user typed them. ' +
      'If you cannot tell what to do, call clarify. Existing contacts: ' + list;

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: text.trim() }] }],
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
        generationConfig: { temperature: 0 },
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'AI request failed.' });

    const parts = data.candidates?.[0]?.content?.parts || [];
    const actions = parts
      .filter((p) => p.functionCall)
      .map((p) => ({ action: p.functionCall.name, ...(p.functionCall.args || {}) }));
    return res.status(200).json({ actions });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error. Check the environment variables in Vercel.' });
  }
};
