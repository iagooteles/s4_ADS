const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
export const IGDB_BASE = "https://api.igdb.com/v4";

export function getEnvCredentials() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  return { clientId, clientSecret };
}

export async function getAppAccessToken(clientId, clientSecret) {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  const res = await fetch(`${TWITCH_TOKEN_URL}?${params}`, { method: "POST" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Falha ao obter token Twitch (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

export async function igdbPost(endpoint, apicalypseBody, token, clientId) {
  const res = await fetch(`${IGDB_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
    },
    body: apicalypseBody,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`IGDB ${endpoint} (${res.status}): ${text}`);
  }
  return res.json();
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
