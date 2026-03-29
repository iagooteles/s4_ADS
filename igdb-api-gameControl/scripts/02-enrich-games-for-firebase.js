/**
 * Passo 2: lê o JSON do passo 1 e reconsulta a IGDB com campos extras
 * (descrição, dev/pub, gêneros, capa) no formato esperado pelo Firestore / modelo Java Game.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import {
  chunk,
  getAppAccessToken,
  getEnvCredentials,
  igdbPost,
  sleep,
} from "./lib/igdb.js";
import { mapIgdbGameToFirestoreDoc } from "./lib/map-igdb-to-firestore.js";

const { clientId, clientSecret } = getEnvCredentials();

const DEFAULT_IN = "data/top-games.json";
const DEFAULT_OUT = "data/games-firebase-ready.json";
const BATCH = 40;
const DELAY_MS = 280;

const IGDB_GAME_FIELDS =
  "fields id,name,slug,storyline,summary,first_release_date," +
  "genres.name," +
  "involved_companies.developer,involved_companies.publisher,involved_companies.company.name," +
  "cover.image_id,url," +
  "total_rating,rating,rating_count,total_rating_count;";

async function fetchGamesFullByIds(ids, token) {
  const batches = chunk(ids, BATCH);
  const all = [];
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const idList = batch.join(",");
    const body = [
      IGDB_GAME_FIELDS,
      `where id = (${idList});`,
      `limit ${batch.length};`,
    ].join(" ");
    const part = await igdbPost("/games", body, token, clientId);
    all.push(...part);
    if (b < batches.length - 1) await sleep(DELAY_MS);
  }
  return new Map(all.map((g) => [g.id, g]));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let inPath = DEFAULT_IN;
  let outPath = DEFAULT_OUT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--in" && args[i + 1]) {
      inPath = args[i + 1];
      i++;
    } else if (args[i] === "--out" && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    }
  }
  return { inPath, outPath };
}

async function main() {
  if (!clientId || !clientSecret) {
    console.error("Defina TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no .env.");
    process.exit(1);
  }

  const { inPath, outPath } = parseArgs();
  const absIn = path.resolve(inPath);
  const raw = await fs.readFile(absIn, "utf8");
  const step1 = JSON.parse(raw);
  if (!Array.isArray(step1) || step1.length === 0) {
    console.error("Arquivo de entrada inválido ou vazio:", absIn);
    process.exit(1);
  }

  console.error("Passo 2: enriquecendo", step1.length, "jogos (IGDB)…");
  const token = await getAppAccessToken(clientId, clientSecret);
  const ids = step1.map((row) => row.id);
  const byId = await fetchGamesFullByIds(ids, token);

  const docs = [];
  for (const row of step1) {
    const full = byId.get(row.id);
    if (!full) {
      console.error("Aviso: jogo id", row.id, "não retornado na segunda consulta.");
      continue;
    }
    docs.push(
      mapIgdbGameToFirestoreDoc(full, {
        rank: row.rank,
        igdbPopularityValue: row.igdb_popularity_value,
      })
    );
  }

  const absOut = path.resolve(outPath);
  await fs.mkdir(path.dirname(absOut), { recursive: true });
  await fs.writeFile(absOut, JSON.stringify(docs, null, 2), "utf8");
  console.error("Salvo", docs.length, "documentos em", absOut);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
