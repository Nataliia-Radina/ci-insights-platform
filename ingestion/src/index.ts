import "dotenv/config";
import { Octokit } from "@octokit/rest";
import path from "node:path";
import fs from "node:fs";

import { getToken, parseArgs } from "./config";
import { downloadToFile } from "./download";
import { ensureDir, writeJson } from "./filesystem";

async function main() {
  const token = getToken();
  const { owner, repo, limit } = parseArgs();

  const octokit = new Octokit({ auth: token });

  const outDir = path.resolve("out", owner, repo);
  ensureDir(outDir);

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
  const runDir = path.join(outDir, String(runId));
  ensureDir(runDir);

  for (const job of jobs) {
    const logsResp = await octokit.request(
      "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
      { owner, repo, job_id: job.id, request: { redirect: "manual" } }
    );

    const redirectUrl =
      (logsResp as any).headers?.location ??
      (logsResp as any).url;

    if (!redirectUrl) {
      console.warn(`No log URL for job ${job.id} (${job.name})`);
      continue;
    }

    const zipPath = path.join(runDir, `job-${job.id}.zip`);
    await downloadToFile(redirectUrl, zipPath);

    index.artifacts.push({ jobId: job.id, zipPath });
    console.log(`Downloaded logs: ${job.name} -> ${zipPath}`);
  }

  // 5) Save index JSON
  const indexPath = path.join(runDir, "index.json");
  writeJson(indexPath, index);

  console.log(`Done. Index: ${indexPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});