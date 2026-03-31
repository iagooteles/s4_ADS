/**
 * Passo 1: busca os jogos com maior PopScore (visitas IGDB) e mescla com dados básicos de /games.
 * Por padrão exclui tema erótico (IGDB id 42) e classificações etárias adultas explícitas (AO, R18, etc.).
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
import {
  filterMatureDisabled,
  passesMatureContentFilter,
} from "./lib/filter-mature-content.js";

const POPULARITY_TYPE_IGDB_VISITS = 1;
const TOP_N = 200;
/** Ao filtrar, pedimos mais candidatos na lista de popularidade (máx. 500 na IGDB). */
const PRIMITIVE_LIMIT_FILTERED = Math.min(TOP_N * 4, 500);

const { clientId, clientSecret } = getEnvCredentials();

async function fetchTopPopularityRows(token, limit) {
  const body = [
    "fields game_id,value;",
    `sort value desc;`,
    `limit ${limit};`,
    `where popularity_type = ${POPULARITY_TYPE_IGDB_VISITS};`,
  ].join(" ");
  return igdbPost("/popularity_primitives", body, token, clientId);
}

async function fetchGamesByIds(ids, token, { forMatureFilter }) {
  const batches = chunk(ids, 50);
  const games = [];
  const fieldsLine =
    "fields id,name,slug,first_release_date,total_rating,rating,rating_count,total_rating_count,url,cover.image_id" +
    (forMatureFilter ? ",themes,age_ratings.rating_category.rating;" : ";");
  for (const batch of batches) {
    const idList = batch.join(",");
    const body = [
      fieldsLine,
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
  const filterMature = !filterMatureDisabled();
  const primitiveLimit = filterMature ? PRIMITIVE_LIMIT_FILTERED : TOP_N;

  console.error(
    "Passo 1: top",
    TOP_N,
    "por PopScore",
    filterMature ? "(filtrando adulto/erótico)" : "(sem filtro — IGDB_FILTER_MATURE=0)"
  );
  const token = await getAppAccessToken(clientId, clientSecret);
  const primitives = await fetchTopPopularityRows(token, primitiveLimit);
  if (primitives.length === 0) {
    console.error("Nenhum registro em popularity_primitives.");
    process.exit(1);
  }

  const orderedIds = primitives.map((p) => p.game_id);
  const byId = await fetchGamesByIds(orderedIds, token, {
    forMatureFilter: filterMature,
  });

  const merged = [];
  for (let i = 0; i < primitives.length && merged.length < TOP_N; i++) {
    const { game_id: id, value } = primitives[i];
    const g = byId.get(id);
    if (!g) continue;
    if (filterMature && !passesMatureContentFilter(g)) {
      console.error("Filtrado:", g.name ?? id, "(tema erótico ou classificação adulta explícita)");
      continue;
    }
    merged.push({
      rank: merged.length + 1,
      igdb_popularity_value: value,
      ...g,
    });
  }

  if (merged.length < TOP_N) {
    console.error(
      `Aviso: só ${merged.length} jogos após o filtro (meta ${TOP_N}). Defina IGDB_FILTER_MATURE=0 para desligar ou aceite lista menor.`
    );
  }

  const json = JSON.stringify(merged, null, 2);

  if (outPath) {
    const abs = path.resolve(outPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, json, "utf8");
    console.error("Salvo em", abs, `(${merged.length} jogos)`);
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
