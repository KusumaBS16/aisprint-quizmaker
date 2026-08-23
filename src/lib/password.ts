// The crypto boundary. Phase 3 defines the interface that the route handlers call and their
// tests mock; Phase 4 replaces these bodies with Web Crypto PBKDF2-SHA256 per OD3. The stubs
// throw rather than return a placeholder so that an unmocked caller fails loudly instead of
// storing something that is not a hash.
const NOT_IMPLEMENTED =
  "Password hashing is implemented in Phase 4 (see OD3 in the sprint PRD)";

export async function hashPassword(password: string): Promise<string> {
  void password;
  throw new Error(NOT_IMPLEMENTED);
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  void password;
  void storedHash;
  throw new Error(NOT_IMPLEMENTED);
}
