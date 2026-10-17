# Weekly Activity Digest – EventBridge Kickoff (SAM)

SAM stack that schedules the weekly activity digest kickoff (EventBridge Scheduler → Lambda → `/api/internal/weekly-activity-digest/run`).

Full instructions (how it works, prerequisites, configuration, deploy, testing, operations, and removal) are in [README-Weekly-Activity-Digest.md › Scheduled kickoff (EventBridge)](../../docs/readme-docs/README-Weekly-Activity-Digest.md#scheduled-kickoff-eventbridge).

Quick deploy (from this folder, with a deploy-capable AWS profile):

```powershell
sam validate --lint
sam build
sam deploy
```
