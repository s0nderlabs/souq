const SKILL_URL = "https://raw.githubusercontent.com/s0nderlabs/souq/main/.agents/skills/souq/SKILL.md";

export async function GET() {
  const res = await fetch(SKILL_URL, { next: { revalidate: 300 } }); // cache 5 min
  const text = await res.text();

  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
