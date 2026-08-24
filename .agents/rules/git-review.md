---
name: git-review-protocol
description: Mandatory two-subagent code review protocol before every git commit
trigger: always_on
---

# Mandatory Git Commit Protocol: Two Reviewers

Before EVERY `git commit` execution:
1. Direct commits without prior review and explicit user approval are STRICTLY PROHIBITED.
2. The agent MUST spawn two reviewer subagents:
   - **Friendly Reviewer**: validates alignment with goals, architectural cleanliness, test coverage, developer experience (DX), and value of changes.
   - **Toxic/Hardcore Reviewer**: ruthlessly hunts for bugs, memory leaks, async race conditions, hidden `any` types, type regressions, and unhandled edge-cases.
3. Await reports from both reviewers.
4. Compile and present to the user:
   - Summary of Changes (Diff Summary).
   - Highlights from the Friendly Reviewer report.
   - Highlights from the Toxic Reviewer report.
   - Request for explicit user approval to commit.
5. Execute `git commit` ONLY after explicit confirmation from the user.
