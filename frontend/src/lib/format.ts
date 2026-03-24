export function jobDisplayTitle(title?: string | null, description?: string | null): string {
  if (title) return title;
  if (!description) return "Untitled job";
  return description.length > 80 ? description.slice(0, 80) + "..." : description;
}
