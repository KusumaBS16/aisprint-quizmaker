// The crypto boundary. Nothing outside this module writes or parses the stored hash string,
// and nothing inside it knows about HTTP or D1. Parameters are OD3 in the sprint PRD.
const ALGORITHM = "pbkdf2-sha256";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// Annotated as ArrayBuffer-backed rather than plain Uint8Array, because crypto.subtle's
// BufferSource will not accept a view that might sit on a SharedArrayBuffer.
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BITS,
  );

  return new Uint8Array(bits);
}

// Accumulates a difference across every byte instead of returning on the first mismatch, so
// the comparison does not leak how much of the key matched. A unit test cannot honestly prove
// timing behaviour, so this is a code-review guarantee rather than a tested one.
function equalInConstantTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }

  return difference === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(password, salt, ITERATIONS);

  return [ALGORITHM, ITERATIONS, toBase64(salt), toBase64(key)].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4) {
    throw new Error("Stored password hash is malformed");
  }

  const [algorithm, rawIterations, rawSalt, rawKey] = parts;

  if (algorithm !== ALGORITHM) {
    throw new Error(`Unsupported password hash algorithm: ${algorithm}`);
  }

  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error("Stored password hash has an invalid iteration count");
  }

  let salt: Uint8Array<ArrayBuffer>;
  let expectedKey: Uint8Array;
  try {
    salt = fromBase64(rawSalt);
    expectedKey = fromBase64(rawKey);
  } catch {
    throw new Error("Stored password hash is not valid base64");
  }

  // The stored iteration count is used rather than the current constant, so a row written
  // under different parameters still verifies. That is the point of the self-describing format.
  const actualKey = await deriveKey(password, salt, iterations);

  return equalInConstantTime(actualKey, expectedKey);
}
