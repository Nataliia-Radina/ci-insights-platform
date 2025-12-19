export type Args = { owner: string; repo: string; limit: number };

export function getToken(): string {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("Missing GITHUB_TOKEN in ingestion/.env");
    return token;
  }

export function parseArgs(): Args {
  const owner = process.argv[2];
  const repo = process.argv[3];
  const limit = Number(process.argv[4] ?? "5");
  if (!owner || !repo) {
    console.error("Usage: ts-node src/index.ts <owner> <repo> [limit]");
    process.exit(1);
  }
  return { owner, repo, limit };
}