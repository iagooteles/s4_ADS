/**
 * Filtro de conteúdo adulto / 18+ explícito na IGDB.
 *
 * - Tema "Erotic" = id 42 (oficial: https://api-docs.igdb.com/#apicalypse — "Removing erotic games")
 * - Classificações: rótulos em age_ratings.rating_category.rating (string) para AO, R18, etc.
 *
 * Jogos sem classificação ou sem tema 42 passam (só excluímos o que a API marca claramente).
 */

/** @type {number} */
export const IGDB_THEME_EROTIC = 42;

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Rótulos típicos em age_rating_categories.rating (IGDB).
 * Não incluímos "M" (ESRB 17+) para reduzir falsos positivos.
 */
const BLOCKED_RATING_LABELS = new Set([
  "ao",
  "adults only",
  "adult only",
  "r18",
  "rc",
  "18",
  "18+",
  "z", // CERO Z (adulto no Japão)
  "usk_18",
  "eighteen",
  "grac_eighteen",
  "class_ind_eighteen",
  "acb_r18",
]);

/**
 * @param {unknown} game — objeto retornado por /games com themes e age_ratings expandidos
 * @returns {boolean} true = jogo permitido (não é adulto/erótico pelos critérios abaixo)
 */
export function passesMatureContentFilter(game) {
  if (!game || typeof game !== "object") return false;

  const themes = game.themes;
  if (Array.isArray(themes) && themes.includes(IGDB_THEME_EROTIC)) {
    return false;
  }

  const ageRatings = game.age_ratings;
  if (!Array.isArray(ageRatings)) return true;

  for (const ar of ageRatings) {
    const label = ar?.rating_category?.rating;
    if (label == null) continue;
    const n = norm(label);
    if (BLOCKED_RATING_LABELS.has(n)) return false;
    if (n.includes("adult only") || n.includes("adults only")) return false;
    // PEGI e similares só com número (ex.: "12", "18")
    if (/^\d{1,3}$/.test(n) && Number.parseInt(n, 10) >= 18) return false;
  }

  return true;
}

export function filterMatureDisabled() {
  return process.env.IGDB_FILTER_MATURE === "0";
}
