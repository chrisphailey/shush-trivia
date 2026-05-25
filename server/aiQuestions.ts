import { z } from "zod";
import { CATEGORIES, type Category, type Question } from "../shared/types";
import { fallbackQuestions } from "./fallbackQuestions";

const questionSchema = z.object({
  question: z.string().trim().min(8),
  choices: z.array(z.string().trim().min(1)).length(4),
  correctAnswer: z.string().trim().min(1)
});

function questionListSchema(count: number) {
  return z.array(questionSchema).length(count).refine(
    (questions) => questions.every((question) => question.choices.includes(question.correctAnswer)),
    "Every correctAnswer must exactly match one choice"
  );
}

function cleanJson(raw: string) {
  return raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function randomizeQuestionChoices(question: Question): Question {
  return {
    ...question,
    choices: shuffle(question.choices)
  };
}

function fallbackSet(category: Category, count: number) {
  const bank = fallbackQuestions[category];
  const selected = shuffle(bank).slice(0, Math.min(count, bank.length));
  return selected.map(randomizeQuestionChoices);
}

export function validateQuestions(raw: unknown, count: number): Question[] {
  const parsed = questionListSchema(count).parse(raw);
  return parsed.map((question) => ({
    question: question.question,
    choices: shuffle(question.choices),
    correctAnswer: question.correctAnswer
  }));
}

export async function generateQuestions(category: Category, count: number): Promise<{ questions: Question[]; usedFallback: boolean; error: string | null }> {
  if (!CATEGORIES.includes(category)) {
    return { questions: fallbackSet("Animals", count), usedFallback: true, error: "Unknown category" };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { questions: fallbackSet(category, count), usedFallback: true, error: "No AI API key configured. Using built-in questions." };
  }

  const prompt = `Generate exactly ${count} family-friendly multiple-choice trivia questions for the category: ${category}.
The audience includes both kids and adults, so keep the content clean, fun, and appropriate.
Make the set more challenging than basic kid trivia: include mostly medium questions, several harder questions, and only a few easy warmups.
Prefer specific, interesting facts over obvious one-word questions.
Each question must have exactly 4 answer choices and exactly 1 correct answer.
Return only valid JSON in this exact format:
[
  {
    "question": "Question text here",
    "choices": ["Choice A", "Choice B", "Choice C", "Choice D"],
    "correctAnswer": "Choice A"
  }
]
Do not include markdown, explanations, comments, or extra text.`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content: "You create safe, clean, family-friendly trivia for kids and adults. Return valid JSON only."
            },
            { role: "user", content: prompt }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`AI request failed with ${response.status}`);
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        throw new Error("AI response did not include text content");
      }

      return { questions: validateQuestions(JSON.parse(cleanJson(text)), count), usedFallback: false, error: null };
    } catch (error) {
      if (attempt === 2) {
        const message = error instanceof Error ? error.message : "AI question generation failed";
        return { questions: fallbackSet(category, count), usedFallback: true, error: message };
      }
    }
  }

  return { questions: fallbackSet(category, count), usedFallback: true, error: "Unknown AI generation failure" };
}
