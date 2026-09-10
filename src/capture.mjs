import { nicheKeys } from "./config.mjs";
import { runCapture } from "./pipeline.mjs";

function usage() {
  console.log(`Uso:
  node src/capture.mjs <nicho> <cidade> [limite]

Nichos prontos: ${nicheKeys().join(", ")}

Ou abra o dashboard:
  npm start
  → http://127.0.0.1:4174
`);
}

const nicheArg = process.argv[2];
const cityArg = process.argv[3];
const limitArg = Number(process.argv[4]);

if (!nicheArg || !cityArg || nicheArg === "-h" || nicheArg === "--help") {
  usage();
  process.exit(nicheArg ? 0 : 1);
}

const result = await runCapture(
  { niche: nicheArg, city: cityArg, limit: limitArg },
  {
    onProgress: (p) => {
      if (p.message) console.log(`[${p.percent ?? "?"}%] ${p.message}`);
    },
  }
);

console.log(JSON.stringify(result.summary, null, 2));
