const BR_PHONE_RE =
  /(?:\+?55[\s.-]?)?(?:\(?0?\d{2}\)?[\s.-]?)(?:9?\d{4}|\d{4})[\s.-]?\d{4}\b/g;

const BAD_PHONE_RE = /^(0800|0300|400[34]|3003)/;

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizePhone(raw) {
  let d = digitsOnly(raw);
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0") && d.length >= 11) d = d.slice(1);
  if (d.length < 10 || d.length > 11) return "";
  if (BAD_PHONE_RE.test(d)) return "";
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length === 9) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
  return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
}

export function extractPhonesFromText(text) {
  const found = new Set();
  const src = String(text || "");
  for (const match of src.matchAll(BR_PHONE_RE)) {
    const n = normalizePhone(match[0]);
    if (n) found.add(n);
  }
  return [...found];
}

export function pickBestPhone(candidates) {
  const list = (candidates || []).map(normalizePhone).filter(Boolean);
  if (!list.length) return "";
  const mobile = list.find((p) => digitsOnly(p).length === 11);
  return mobile || list[0];
}

export function phonesFromOsmTags(tags = {}) {
  const keys = [
    "phone",
    "contact:phone",
    "mobile",
    "contact:mobile",
    "whatsapp",
    "contact:whatsapp",
    "telephone",
  ];
  const values = [];
  for (const key of keys) {
    const v = tags[key];
    if (!v) continue;
    for (const part of String(v).split(/[;/|]/)) values.push(part);
  }
  return pickBestPhone(values);
}
