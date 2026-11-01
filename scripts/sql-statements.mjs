/** Split PostgreSQL migration files without splitting quoted text or comments. */
export function splitSqlStatements(source) {
  const statements = [];
  let buffer = "",
    state = "normal",
    tag = "",
    depth = 0,
    code = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i],
      next = source[i + 1];
    if (state === "line") {
      buffer += char;
      if (char === "\n") state = "normal";
      continue;
    }
    if (state === "block") {
      buffer += char;
      if (char === "/" && next === "*") {
        buffer += next;
        i++;
        depth++;
      } else if (char === "*" && next === "/") {
        buffer += next;
        i++;
        if (--depth === 0) state = "normal";
      }
      continue;
    }
    if (state === "dollar") {
      if (source.startsWith(tag, i)) {
        buffer += tag;
        i += tag.length - 1;
        state = "normal";
      } else buffer += char;
      continue;
    }
    if (state === "single" || state === "double") {
      buffer += char;
      const quote = state === "single" ? "'" : '"';
      if (char === quote) {
        if (next === quote) {
          buffer += next;
          i++;
        } else state = "normal";
      }
      continue;
    }
    if (char === "-" && next === "-") {
      buffer += "--";
      i++;
      state = "line";
      continue;
    }
    if (char === "/" && next === "*") {
      buffer += "/*";
      i++;
      state = "block";
      depth = 1;
      continue;
    }
    if (char === ";") {
      if (code) statements.push(buffer.trim());
      buffer = "";
      code = false;
      continue;
    }
    if (char === "'" || char === '"')
      state = char === "'" ? "single" : "double";
    else if (char === "$") {
      const match = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        tag = match[0];
        buffer += tag;
        i += tag.length - 1;
        state = "dollar";
        code = true;
        continue;
      }
    }
    buffer += char;
    if (!/\s/.test(char)) code = true;
  }
  if (!["normal", "line"].includes(state))
    throw new Error("Unterminated quote or comment in database migration.");
  if (code) statements.push(buffer.trim());
  return statements;
}
