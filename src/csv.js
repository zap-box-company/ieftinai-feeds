// Minimal streaming RFC 4180 CSV parser (quoted fields, "" escapes, newlines inside quotes).
// Feeds are 200+ MB, so rows are yielded one by one instead of loading the file.

export async function* parseCsv(textChunks) {
  let field = "";
  let row = [];
  let inQuotes = false;
  let quotePending = false; // saw a quote inside a quoted field; next char decides

  for await (const chunk of textChunks) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inQuotes) {
        if (quotePending) {
          quotePending = false;
          if (c === '"') {
            field += '"';
            continue;
          }
          inQuotes = false; // closing quote; fall through to handle c normally
        } else if (c === '"') {
          quotePending = true;
          continue;
        } else {
          field += c;
          continue;
        }
      }
      if (c === '"' && field === "") {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
        yield row;
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
  }
  if (quotePending) inQuotes = false;
  if (field !== "" || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/** Yields objects keyed by the (lower-cased) header row. */
export async function* parseCsvObjects(textChunks) {
  let header = null;
  for await (const row of parseCsv(textChunks)) {
    if (!header) {
      header = row.map((h) => h.trim().toLowerCase());
      continue;
    }
    if (row.length === 1 && row[0] === "") continue;
    const obj = {};
    header.forEach((h, i) => (obj[h] = row[i] ?? ""));
    yield obj;
  }
}

/** Turns a fetch Response body into decoded text chunks. */
export async function* responseText(response) {
  const decoder = new TextDecoder("utf-8");
  for await (const bytes of response.body) yield decoder.decode(bytes, { stream: true });
  const tail = decoder.decode();
  if (tail) yield tail;
}
