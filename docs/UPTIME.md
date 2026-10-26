# Uptime alerts

`ops/uptime.workflow.yml`, once copied to `.github/workflows/uptime.yml`, runs `scripts/uptime_check.sh` every 30 minutes, day and night.

It checks four public addresses and needs no secrets:

| Check | Address | Passes when |
| --- | --- | --- |
| Site home | https://shroomlabs.io/ | 200 and the page says "Shroom Labs" |
| Site config | https://shroomlabs.io/js/config.js | 200 and it points at api.shroomlabs.io |
| API health | https://api.shroomlabs.io/health | 200 and `"ok":true` |
| API data | https://api.shroomlabs.io/api/profiles/pearl-oyster | 200 |

If anything fails it waits 60 seconds and checks again, so one slow answer does not alert.

## Who gets told

Only Mike. A failed scheduled run makes GitHub email the account that last changed the
schedule in the workflow file (themsquared), using GitHub's own notification email. Nothing
is sent to users, Slack, or anyone else. To stop the emails, turn the workflow off under
Actions, Uptime, "Disable workflow".

GitHub sends one email per failed run, so a long outage means one email every 30 minutes.

## Turning it on (Mike)

The bot's GitHub token cannot add workflow files, so the workflow is kept at
`ops/uptime.workflow.yml`. To turn it on:

```bash
git checkout main && git pull
mkdir -p .github/workflows
git show origin/cursor/community-platform-fa9c:ops/uptime.workflow.yml > .github/workflows/uptime.yml
git show origin/cursor/community-platform-fa9c:scripts/uptime_check.sh > scripts/uptime_check.sh
git add .github/workflows/uptime.yml scripts/uptime_check.sh
git commit -m "Uptime check" && git push
```

GitHub only runs schedules from the default branch (`main`), and the alert email goes to the
account that pushes that commit, so push it as themsquared. Then open Actions, Uptime,
"Run workflow" once to see it pass.

## Run it by hand

```bash
bash scripts/uptime_check.sh
```
