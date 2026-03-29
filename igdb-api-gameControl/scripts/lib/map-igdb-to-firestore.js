/** URL pública da capa (tamanho grande). Ver https://api-docs.igdb.com/#images */
export function igdbCoverImageUrl(imageId) {
  if (imageId == null || imageId === "") return null;
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
}

function uniqueJoin(names, sep = ", ") {
  return [...new Set(names.filter(Boolean))].join(sep);
}

/**
 * Mapeia resposta do endpoint /games (com subcampos expandidos) para o formato
 * compatível com o modelo Java Game / GameDTO (los-pitufs-backend-java).
 */
export function mapIgdbGameToFirestoreDoc(igdbGame, { rank, igdbPopularityValue } = {}) {
  const involved = Array.isArray(igdbGame.involved_companies)
    ? igdbGame.involved_companies
    : [];

  const developers = involved
    .filter((ic) => ic.developer)
    .map((ic) => ic.company?.name)
    .filter(Boolean);
  const publishers = involved
    .filter((ic) => ic.publisher)
    .map((ic) => ic.company?.name)
    .filter(Boolean);

  const rawDesc =
    [igdbGame.summary, igdbGame.storyline].find(
      (s) => typeof s === "string" && s.trim().length > 0
    ) ?? "";
  const description =
    rawDesc.length > 2000 ? rawDesc.slice(0, 2000) : rawDesc;

  let releaseDate = null;
  if (igdbGame.first_release_date != null) {
    releaseDate = new Date(igdbGame.first_release_date * 1000)
      .toISOString()
      .slice(0, 10);
  }

  const imageId =
    igdbGame.cover?.image_id ??
    (typeof igdbGame.cover === "object" && igdbGame.cover != null
      ? igdbGame.cover.image_id
      : null);

  const genreNames = (Array.isArray(igdbGame.genres) ? igdbGame.genres : [])
    .map((g) => g?.name)
    .filter(Boolean);

  const doc = {
    igdbId: igdbGame.id,
    title: igdbGame.name ?? "",
    description,
    developer: uniqueJoin(developers) || null,
    publisher: uniqueJoin(publishers) || null,
    releaseDate,
    coverImageUrl: igdbCoverImageUrl(imageId),
    genres: uniqueJoin(genreNames) || null,
    slug: igdbGame.slug ?? null,
    igdbUrl: igdbGame.url ?? null,
  };

  if (rank != null) doc.rank = rank;
  if (igdbPopularityValue != null) doc.igdbPopularityValue = igdbPopularityValue;

  if (igdbGame.total_rating != null) doc.totalRating = igdbGame.total_rating;
  if (igdbGame.rating != null) doc.rating = igdbGame.rating;
  if (igdbGame.total_rating_count != null) {
    doc.totalRatingCount = igdbGame.total_rating_count;
  }
  if (igdbGame.rating_count != null) doc.ratingCount = igdbGame.rating_count;

  return doc;
}
