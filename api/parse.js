// Vercel serverless function (api/parse.js)

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

// Fallback parser if LLM returns text instead of calling a function
function parseFallback(text) {
  const clean = text.trim();
  const phoneMatch = clean.match(/\d{7,15}/);
  const phone = phoneMatch ? phoneMatch[0] : "";

  if (clean.toLowerCase().startsWith("delete")) {
    const name = clean.replace(/delete/i, "").trim();
    if (name) return { name: "delete_contact", args: { name } };
  }

  if (clean.toLowerCase().startsWith("update")) {
    const name = clean
      .replace(/update/i, "")
      .replace(phone, "")
      .replace(/number|to|his|her|phone/gi, "")
      .trim();
    if (name && phone) return { name: "update_contact", args: { name, phone } };
  }

  if (clean.toLowerCase().startsWith("add") || phone) {
    const name = clean
      .replace(/add|user|number/gi, "")
      .replace(phone, "")
      .replace(/his|her|phone/gi, "")
      .trim();
    if (name && phone) return { name: "add_contact", args: { name, phone } };
  }

  return null;
}

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
        model: "openrouter/free",
        messages: [
          {
            role: "system",
            content: "You are a JSON parser. You must call one of the provided tools to handle the user's contact request."
          },
          { role: "user", content: text }
        ],
        tools: functionDeclarations.map((fn) => ({ type: "function", function: fn })),
        tool_choice: "required", // Forces model to call a function instead of returning plain text
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "OpenRouter API error" });
    }

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    // Case 1: AI structured tool call succeeded
    if (toolCall) {
      const actionObj = {
        name: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments),
      };

      return res.status(200).json({
        actions: [actionObj],
        action: actionObj.name,
        args: actionObj.args,
      });
    }

    // Case 2: AI returned text instead of a tool call -> trigger local regex fallback
    const fallback = parseFallback(text);
    if (fallback) {
      return res.status(200).json({
        actions: [fallback],
        action: fallback.name,
        args: fallback.args,
      });
    }

    return res.status(400).json({ error: "Could not parse contact action from prompt." });
  } catch (err) {
    // Case 3: Network/API failure -> try local regex fallback
    const fallback = parseFallback(text);
    if (fallback) {
      return res.status(200).json({
        actions: [fallback],
        action: fallback.name,
        args: fallback.args,
      });
    }

    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
