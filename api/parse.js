// Vercel serverless function: sends the user's sentence to Google Gemini (free tier) with tool definitions.
// Needs env vars: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY

const str = { type: "STRING" };

const functionDeclarations = [
  {
    name: "add_contact",
    description: "Add a new contact with a name and phone number.",
    parameters: { type: "OBJECT", properties: { name: str, phone: str }, required: ["name", "phone"] },
  },
  {
    name: "update_contact",
    description: "Update an existing contact's phone number by name.",
    parameters: { type: "OBJECT", properties: { name: str, phone: str }, required: ["name", "phone"] },
  },
  {
    name: "delete_contact",
    description: "Delete a contact by name.",
    parameters: { type: "OBJECT", properties: { name: str }, required: ["name"] },
  },
];

// Helper to make API requests to Google Gemini with exponential backoff on retryable errors
async function callGeminiWithRetry(url, options, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, options);
    
    // If successful, return response
    if (res.ok) return res;

    // Handle high demand (503) or rate limits (429) by waiting and retrying
    if ((res.status === 503 || res.status === 429) && i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
      continue;
    }

    return res;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Text prompt is required" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY environment variable is missing" });
  }

  // Using gemini-1.5-flash: high availability, fast, and free tier friendly
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: text }],
      },
    ],
    tools: [
      {
        functionDeclarations: functionDeclarations,
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: "ANY", // Forces Gemini to call one of our defined function tools
        allowedFunctionNames: ["add_contact", "update_contact", "delete_contact"],
      },
    },
  };

  try {
    const response = await callGeminiWithRetry(
      apiUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      3,
      1000
    );

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 503 || response.status === 429) {
        return res.status(503).json({
          error: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
        });
      }
      return res.status(response.status).json({ error: data.error?.message || "Failed to call Gemini API" });
    }

    // Extract function call response from Gemini
    const call = data.candidates?.[0]?.content?.parts?.[0]?.functionCall;

    if (!call) {
      return res.status(400).json({ error: "Could not identify action from input text." });
    }

    return res.status(200).json({
      action: call.name,
      args: call.args,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
