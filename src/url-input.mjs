// Accept a bare host and path without changing stored URL or backup validation.
export function normalizeEnteredUrl(value) {
  const input = value.trim();
  if (!input) return "";

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(input);
  const hasPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(input);
  const candidate = input.startsWith("//") ? `https:${input}`
    : hasScheme && !hasPort ? input : `https://${input}`;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}
