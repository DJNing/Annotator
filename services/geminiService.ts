import { GoogleGenAI, Type } from "@google/genai";

// Initialize the API client
// Note: In a real production app, you might proxy this through a backend to protect the key,
// or use the ephemeral key provided by the user in a settings dialog if not in env.
const apiKey = process.env.API_KEY || ''; 
const ai = new GoogleGenAI({ apiKey });

export const detectObjectsInImage = async (base64Image: string): Promise<string[]> => {
  if (!apiKey) {
    console.warn("No API Key found");
    return ["Object A", "Object B"]; // Fallback for demo without key
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image.split(',')[1] // Remove data:image/png;base64, prefix if present
            }
          },
          {
            text: "Analyze this image and list the distinct foreground objects that would be suitable for instance segmentation. Return just a list of labels."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          }
        }
      }
    });

    if (response.text) {
        return JSON.parse(response.text);
    }
    return [];
  } catch (error) {
    console.error("Gemini detection error:", error);
    return [];
  }
};