import { RUNTIME } from "../config.mjs";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function levelOk(level) {
  return (LEVELS[level] ?? 2) <= (LEVELS[RUNTIME.logLevel] ?? 2);
}

function line(level, msg, fields) {
  const row = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields && typeof fields === "object" ? fields : {}),
  };
  const text = JSON.stringify(row);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const log = {
  error(msg, fields) {
    if (levelOk("error")) line("error", msg, fields);
  },
  warn(msg, fields) {
    if (levelOk("warn")) line("warn", msg, fields);
  },
  info(msg, fields) {
    if (levelOk("info")) line("info", msg, fields);
  },
  debug(msg, fields) {
    if (levelOk("debug")) line("debug", msg, fields);
  },
};
