/**
 * Passo 3: grava os documentos enriquecidos no Cloud Firestore.
 * ID do documento = String(igdbId) para upserts idempotentes.
 *
 * Por padrão usa merge: só cria/atualiza. Documentos antigos que sumiram do JSON
 * continuam no Firestore — use --prune para alinhar o banco ao arquivo.
 *
 * Credenciais: arquivo JSON de conta de serviço (Firebase Console →
 * Configurações do projeto → Contas de serviço → Gerar nova chave privada).
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const DEFAULT_IN = "data/games-firebase-ready.json";
const DEFAULT_COLLECTION = "games";

function parseArgs() {
  const args = process.argv.slice(2);
  let inPath = DEFAULT_IN;
  let collection = process.env.FIRESTORE_COLLECTION || DEFAULT_COLLECTION;
  let prune = process.env.FIRESTORE_PRUNE_ORPHANS === "1";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--in" && args[i + 1]) {
      inPath = args[i + 1];
      i++;
    } else if (args[i] === "--collection" && args[i + 1]) {
      collection = args[i + 1];
      i++;
    } else if (args[i] === "--prune") {
      prune = true;
    }
  }
  return { inPath, collection, prune };
}

function resolveCredentialPath(keyPath) {
  const trimmed = keyPath.trim();
  return path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(process.cwd(), trimmed);
}

async function initFirebaseAdmin() {
  const keyPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (keyPath) {
    const abs = resolveCredentialPath(keyPath);
    try {
      await fs.access(abs);
    } catch {
      throw new Error(
        `Arquivo de credenciais do Firebase não encontrado:\n  ${abs}\n\n` +
          `Corrija FIREBASE_SERVICE_ACCOUNT_PATH (ou GOOGLE_APPLICATION_CREDENTIALS) no .env para o caminho ` +
          `do JSON que você baixou no Console Firebase (Projeto → Contas de serviço → “Gerar nova chave privada”). ` +
          `O nome costuma ser algo como *-firebase-adminsdk-*.json; não use placeholder ou arquivo que ainda não existe. ` +
          `Dica: coloque o arquivo em ./secrets/ e use FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/seu-arquivo.json`
      );
    }
    let json;
    try {
      json = JSON.parse(await fs.readFile(abs, "utf8"));
    } catch (e) {
      throw new Error(
        `Não foi possível ler o JSON de credenciais em:\n  ${abs}\n\n` +
          (e instanceof SyntaxError ? "O conteúdo não é JSON válido.\n" : String(e))
      );
    }
    if (getApps().length === 0) {
      initializeApp({ credential: cert(json) });
    }
    return;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const json = JSON.parse(raw);
    if (getApps().length === 0) {
      initializeApp({ credential: cert(json) });
    }
    return;
  }

  throw new Error(
    "Defina FIREBASE_SERVICE_ACCOUNT_PATH (caminho para o .json da conta de serviço) " +
      "ou FIREBASE_SERVICE_ACCOUNT_JSON (JSON inline) ou GOOGLE_APPLICATION_CREDENTIALS."
  );
}

/**
 * Remove documentos da coleção cujo ID não está em allowedIds.
 * Cuidado: apaga também jogos criados manualmente na mesma coleção se não estiverem no JSON.
 */
async function pruneOrphans(db, collectionName, allowedIds) {
  const allowed = new Set(allowedIds.map(String));
  const snap = await db.collection(collectionName).get();
  const toDelete = snap.docs.filter((d) => !allowed.has(d.id));
  if (toDelete.length === 0) {
    console.error("Prune: nenhum documento órfão (coleção já alinhada ao JSON).");
    return 0;
  }
  const chunkSize = 400;
  for (let i = 0; i < toDelete.length; i += chunkSize) {
    const slice = toDelete.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const doc of slice) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    console.error(
      "Prune: removidos",
      Math.min(i + chunkSize, toDelete.length),
      "/",
      toDelete.length,
      "documentos que não estão no JSON"
    );
  }
  return toDelete.length;
}

async function main() {
  const { inPath, collection, prune } = parseArgs();
  const absIn = path.resolve(inPath);
  const raw = await fs.readFile(absIn, "utf8");
  const docs = JSON.parse(raw);
  if (!Array.isArray(docs) || docs.length === 0) {
    console.error("Nada para enviar:", absIn);
    process.exit(1);
  }

  await initFirebaseAdmin();
  const db = getFirestore();

  const allowedIds = [];
  for (const doc of docs) {
    if (doc.igdbId != null) allowedIds.push(doc.igdbId);
  }

  console.error(
    "Passo 3: enviando",
    docs.length,
    "documentos para",
    collection,
    "…"
  );

  const batchSize = 400;
  for (let i = 0; i < docs.length; i += batchSize) {
    const slice = docs.slice(i, i + batchSize);
    const batch = db.batch();
    for (const doc of slice) {
      const igdbId = doc.igdbId;
      if (igdbId == null) {
        console.error("Documento sem igdbId, ignorado:", doc.title);
        continue;
      }
      const ref = db.collection(collection).doc(String(igdbId));
      batch.set(
        ref,
        {
          ...doc,
          syncedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
    console.error("Commit", Math.min(i + batchSize, docs.length), "/", docs.length);
  }

  if (prune) {
    console.error(
      "Prune ativo: removendo da coleção qualquer documento cujo ID não está em",
      path.basename(absIn),
      "…"
    );
    await pruneOrphans(db, collection, allowedIds);
  } else {
    console.error(
      "Dica: se o Firebase ainda tiver jogos antigos (ex.: 18+ já filtrados no JSON), rode com --prune ou FIRESTORE_PRUNE_ORPHANS=1 para apagar só o que não está no arquivo."
    );
  }

  console.error("Concluído.");
}

function printFirebaseAuthHelp(err) {
  const code = err?.code;
  const reason = err?.reason ?? err?.details?.reason;
  const msg = String(err?.message ?? "");
  const isAuth =
    code === 16 ||
    reason === "ACCOUNT_STATE_INVALID" ||
    /UNAUTHENTICATED|invalid authentication/i.test(msg);
  if (!isAuth) return false;
  console.error(`
--- Firebase / credenciais ---
O Google rejeitou a conta de serviço (UNAUTHENTICATED / ACCOUNT_STATE_INVALID).

O que fazer:
1. Firebase Console → Configurações do projeto → Contas de serviço → "Gerar nova chave privada"
   (ou Google Cloud → IAM → Contas de serviço → sua conta → Chaves → Adicionar chave JSON).
2. Substitua o arquivo no caminho de FIREBASE_SERVICE_ACCOUNT_PATH no .env.
3. Se a chave antiga foi revogada ou a conta desativada, só uma chave NOVA funciona.
4. Confirme que o project_id no JSON é o projeto onde o Firestore está ativo.

Detalhe: ${reason ?? code ?? msg.slice(0, 120)}
`);
  return true;
}

try {
  await main();
} catch (err) {
  console.error(err);
  if (!printFirebaseAuthHelp(err)) {
    /* erro genérico já impresso acima */
  }
  process.exit(1);
}
