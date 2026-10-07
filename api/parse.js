// Vercel serverless function (api/parse.js)
// Make sure OPENROUTER_API_KEY is set in your Vercel Environment Variables

const functionDeclarations = [
  {
    name: "add_contact",
    description: "Add a new contact with a name and phone number.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
      },
      required: ["name", "phone"],
    },
  },
  {
    name: "update_contact",
    description: "Update an existing contact's phone number by name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
      },
      required: ["name", "phone"],
    },
  },
  {
    name: "delete_contact",
    description: "Delete a contact by name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
  },
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Text prompt is required" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY is missing in Vercel environment variables" });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://contact-book-humna7.vercel.app",
        "X-Title": "Contact Book App",
      },
      body: JSON.stringify({
        model: "openrouter/free", // Dynamically routes to any active free model that supports tool calling
        messages: [{ role: "user", content: text }],
        tools: functionDeclarations.map((fn) => ({ type: "function", function: fn })),
        tool_choice: "auto",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "OpenRouter API error" });
    }

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      return res.status(400).json({ error: "Could not identify action from input text." });
    }

    return res.status(200).json({
      action: toolCall.function.name,
      args: JSON.parse(toolCall.function.arguments),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
