import "dotenv/config";
import { Octokit } from "@octokit/rest";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream";
import { promisify } from "node:util";

const streamPipeline = promisify(pipeline);

type Args = { owner: string; repo: string; limit: number };

function parseArgs(): Args {
  const owner = process.argv[2];
  const repo = process.argv[3];
  const limit = Number(process.argv[4] ?? "5");
  if (!owner || !repo) {
    console.error("Usage: ts-node src/index.ts <owner> <repo> [limit]");
    process.exit(1);
  }
  return { owner, repo, limit };
}

async function downloadToFile(url: string, outPath: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  await streamPipeline(res.body as any, fs.createWriteStream(outPath));
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Missing GITHUB_TOKEN in ingestion/.env");

  const { owner, repo, limit } = parseArgs();
  const octokit = new Octokit({ auth: token });

  const outDir = path.resolve("out", owner, repo);
  fs.mkdirSync(outDir, { recursive: true });

  // 1) List workflow runs (recent)
  const runs = await octokit.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    per_page: limit,
  });

  const items = runs.data.workflow_runs ?? [];
  if (!items.length) {
    console.log("No workflow runs found.");
    return;
  }

  // 2) Pick latest run
  const latest = items[0];
  const runId = latest.id;

  // 3) List jobs for run
  const jobsResp = await octokit.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
    per_page: 100,
  });

  const jobs = jobsResp.data.jobs ?? [];

  const index = {
    fetchedAt: new Date().toISOString(),
    owner,
    repo,
    run: {
      id: runId,
      name: latest.name,
      event: latest.event,
      head_branch: latest.head_branch,
      head_sha: latest.head_sha,
      status: latest.status,
      conclusion: latest.conclusion,
      html_url: latest.html_url,
      created_at: latest.created_at,
      updated_at: latest.updated_at,
    },
    jobs: jobs.map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status,
      conclusion: j.conclusion,
      started_at: j.started_at,
      completed_at: j.completed_at,
      html_url: j.html_url,
    })),
    artifacts: [] as Array<{ jobId: number; zipPath: string }>,
  };

  // 4) Download logs per job (ZIP) via REST endpoint
  for (const job of jobs) {
    const jobOutDir = path.join(outDir, String(runId));
    fs.mkdirSync(jobOutDir, { recursive: true });

    // This endpoint requires auth; Octokit gives us a signed URL via redirect.
    const logsResp = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
      { owner, repo, job_id: job.id, request: { redirect: "manual" } }
    );

    // Octokit may follow redirect internally depending on runtime; safest is to read redirect URL.
    const redirectUrl =
      (logsResp as any).headers?.location ??
      (logsResp as any).url; // fallback

    if (!redirectUrl) {
      console.warn(`No log URL for job ${job.id} (${job.name})`);
      continue;
    }

    const zipPath = path.join(jobOutDir, `job-${job.id}.zip`);
    await downloadToFile(redirectUrl, zipPath);

    index.artifacts.push({ jobId: job.id, zipPath });
    console.log(`Downloaded logs: ${job.name} -> ${zipPath}`);
  }

  // 5) Save index JSON
  const indexPath = path.join(outDir, String(runId), "index.json");
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");

  console.log(`Done. Index: ${indexPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});