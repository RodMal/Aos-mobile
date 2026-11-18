---
name: aos-loop
description: Development loop for Aos-mobile. Takes the first Ready task in docs/BACKLOG.md, has an agent implement it on a task branch, opens a PR into main and lets CI judge; merges on green only if CLAUDE.md authorises it, otherwise hands the PR to the owner. Run when the owner says "/aos-loop", "run the loop", "next task", or starts a session to continue development.
argument-hint: '[task-id] [--max N]'
---

# /aos-loop

Arguments: `$ARGUMENTS` (optional task id; `--max N` tasks this session, default 3).

You are the orchestrator. **You do not write code, read source files or run the slow test suites.** You read the backlog, dispatch agents, push branches and open PRs (and merge them only if CLAUDE.md allows). Keep your own context small: every agent reports in a few lines, and the backlog plus git are the durable state, so a fresh session can always resume.

## 0. Once per session

- `cd` to the Aos-mobile checkout. `git fetch origin main`; `git checkout main && git pull --ff-only`. Work always starts from `origin/main`, whatever branch the session was opened on.
- Load the GitHub tools you need (ToolSearch: `create_pull_request`, `merge_pull_request`, `pull_request_read`, `subscribe_pr_activity`, `get_job_logs`).
- If a PR from an earlier session is still open (`list_pull_requests`, head `task/*`), finish it first (step 4) before taking a new task.

## 1. Pick

- The task id given, else the first task under `## Ready` in `docs/BACKLOG.md`. Read only that task's section.
- If it needs an owner decision that is not written down, ask the owner one short question and stop.

## 2. Implement

Dispatch by **Tier**, always with `isolation: "worktree"`, and give the agent only: the task id, "branch off origin/main", and anything the owner said in this session about it.

| Tier            | Agent                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `haiku`         | `aos-chore`                                                                                                     |
| `sonnet`        | `aos-dev`                                                                                                       |
| `sonnet+review` | `aos-dev`, then `aos-review` on the branch; send CHANGES back to the same `aos-dev` (SendMessage) at most twice |
| `opus`          | `aos-dev` with `model: "opus"`                                                                                  |

Ask the implementing agent to finish by moving its task from `## Ready` to `## Done` in `docs/BACKLOG.md` as `id — title` in its last commit.

## 3. Open the PR

- Push the agent's branch under a task name: `git push origin <worktree-branch>:task/<id>` (never force).
- `create_pull_request` into `main`: title `<id>: <task title>`; body = the agent's report (what changed, tests, anything needing the owner), ending with the attribution lines from your session instructions.
- `subscribe_pr_activity` for it and **end your turn**. Do not poll, do not run CI locally: CI events wake you.

## 4. On CI results

- **Green**: if `CLAUDE.md` says the loop may merge, `merge_pull_request` (squash), remove the worktree and branch locally, and continue with step 1 unless `--max` is reached. Otherwise tell the owner in two or three lines that the PR is ready to merge (link it), and stop. The deploy runs from `main` after CI.
- **Red**: `get_job_logs` (failed jobs only, tail ~80 lines). Send the failure to the same agent (SendMessage) to fix on its branch; push again; end the turn. After two failed fixes, stop and tell the owner what is failing.
- **Review comment from the owner**: treat it as a change request for the same agent.

## Budget rules

- One task at a time unless two Ready tasks touch clearly separate areas (e.g. a UI task and an engine task); then at most two in parallel.
- Prefer `aos-chore` (Haiku) whenever a task is mechanical, `aos-dev` (Sonnet) otherwise; `aos-review` (Opus) only reviews diffs or answers a stuck agent's question.
- If a usage limit stops an agent, its commits are safe in its worktree; when the session resumes, `SendMessage` to the same agent to continue rather than starting over.
- The owner's new requests during a session: add them to `docs/BACKLOG.md` as tasks (via `aos-chore`, as part of the next PR), do not handle them ad hoc.
