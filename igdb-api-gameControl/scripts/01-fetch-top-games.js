/**
 * Passo 1: busca os 200 jogos com maior PopScore (visitas IGDB) e mescla com dados básicos de /games.
 * Saída: JSON (stdout ou --out). Próximo passo: 02-enrich-games-for-firebase.js
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import {
  chunk,
  getAppAccessToken,
  getEnvCredentials,
  igdbPost,
} from "./lib/igdb.js";

const POPULARITY_TYPE_IGDB_VISITS = 1;
const TOP_N = 200;

const { clientId, clientSecret } = getEnvCredentials();

async function fetchTopPopularityRows(token) {
  const body = [
    "fields game_id,value;",
    `sort value desc;`,
    `limit ${TOP_N};`,
    `where popularity_type = ${POPULARITY_TYPE_IGDB_VISITS};`,
  ].join(" ");
  return igdbPost("/popularity_primitives", body, token, clientId);
}

async function fetchGamesByIds(ids, token) {
  const batches = chunk(ids, 50);
  const games = [];
  for (const batch of batches) {
    const idList = batch.join(",");
    const body = [
      "fields id,name,slug,first_release_date,total_rating,rating,rating_count,total_rating_count,url,cover.image_id;",
      `where id = (${idList});`,
      `limit ${batch.length};`,
    ].join(" ");
    const part = await igdbPost("/games", body, token, clientId);
    games.push(...part);
  }
  return new Map(games.map((g) => [g.id, g]));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let outPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    }
  }
  return { outPath };
}

async function main() {
  if (!clientId || !clientSecret) {
    console.error(
      "Defina TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET no .env (veja .env.example)."
    );
    process.exit(1);
  }

  const { outPath } = parseArgs();

  console.error("Passo 1: top", TOP_N, "por PopScore…");
  const token = await getAppAccessToken(clientId, clientSecret);
  const primitives = await fetchTopPopularityRows(token);
  if (primitives.length === 0) {
    console.error("Nenhum registro em popularity_primitives.");
    process.exit(1);
  }

  const orderedIds = primitives.map((p) => p.game_id);
  const byId = await fetchGamesByIds(orderedIds, token);

  const merged = [];
  for (let i = 0; i < primitives.length; i++) {
    const { game_id: id, value } = primitives[i];
    const g = byId.get(id);
    if (!g) continue;
    merged.push({
      rank: i + 1,
      igdb_popularity_value: value,
      ...g,
    });
  }

  const json = JSON.stringify(merged, null, 2);

  if (outPath) {
    const abs = path.resolve(outPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, json, "utf8");
    console.error("Salvo em", abs);
  } else {
    console.log(json);
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
