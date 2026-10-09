- [Overview](#overview)
- [PM2 Installation And Configuration Summary](#pm2-installation-and-configuration-summary)
  - [Step 1: Install PM2 Under The EC2 User](#step-1-install-pm2-under-the-ec2-user)
  - [Step 2 Create PM2 App Config In Repo](#step-2-create-pm2-app-config-in-repo)
  - [Step 3: Configure Systemd To Manage PM2 At Boot](#step-3-configure-systemd-to-manage-pm2-at-boot)
  - [Step 4: Load Runtime Env From Parameter Store Output](#step-4-load-runtime-env-from-parameter-store-output)
  - [Step 5: Remove Bad Startup Flags And CWD Drift](#step-5-remove-bad-startup-flags-and-cwd-drift)
  - [Step 6: Stabilize On Single Worker First](#step-6-stabilize-on-single-worker-first)
- [Final Deploy Runbook](#final-deploy-runbook)
  - [Deploy](#deploy)
  - [Verify](#verify)
  - [Rollback](#rollback)
  - [Known-Good Baseline (Do Not Drift)](#known-good-baseline-do-not-drift)
    - [ecosystem.config.cjs](#ecosystemconfigcjs)
    - [/etc/systemd/system/pm2-ec2-user.service](#etcsystemdsystempm2-ec2-userservice)
    - [Post-edit apply/verify](#post-edit-applyverify)
  - [Operating Notes](#operating-notes)
- [Troubleshooting](#troubleshooting)
  - [Query for Errors](#query-for-errors)
  - [Login Blocked by Missing Resend API Key](#login-blocked-by-missing-resend-api-key)
  - [Crashing PM2 Woker(s)](#crashing-pm2-wokers)
  - [Getting PM2 Error Logs](#getting-pm2-error-logs)
  - [The pm2-ec2-user.service Service](#the-pm2-ec2-userservice-service)
- [EC2 runtime issues](#ec2-runtime-issues)
  - [Out of Space on EC2](#out-of-space-on-ec2)
  - [The `npm run build` Hangs](#the-npm-run-build-hangs)
  - [Create a swap file](#create-a-swap-file)
  - [Expanding the EC2 volume](#expanding-the-ec2-volume)
    - [In AWS/EC2](#in-awsec2)
    - [In EC2 instance](#in-ec2-instance)
- [Schema Versioning Strategy](#schema-versioning-strategy)
  - [Recommended approach](#recommended-approach)
  - [Versioning policy](#versioning-policy)
  - [Schema metadata model](#schema-metadata-model)
  - [Startup compatibility check](#startup-compatibility-check)
  - [Safe deployment sequence](#safe-deployment-sequence)
  - [Practical Next Actions](#practical-next-actions)
  - [npm ci Sequence](#npm-ci-sequence)

# Overview

PM2 is a production process manager for Node.js applications. When you host an app on an AWS EC2 instance, running node app.js is not enough because the application will crash if the server reboots or encounters an error. PM2 keeps applications alive 24/7, restarts them automatically if they crash, and reloads them without downtime.

**Key Functions of PM2 on EC2**

- Auto-Restart: Automatically brings your backend server back online if the Node.js process fails or the EC2 instance reboots.
- Zero-Downtime Reloads: Allows you to update your application code and restart the server without dropping active user requests.
- Clustering (Load Balancing): Uses "Cluster Mode" to scale a single instance across all available CPU cores, maximizing the traffic your EC2 server can handle.
- Centralized Logging: Aggregates error and standard output logs into unified files, which you can easily monitor using pm2 logs.

# PM2 Installation And Configuration Summary

This summarizes the final production setup reached in this session, including what changed and why.

## Step 1: Install PM2 Under The EC2 User

```bash
npm install -g pm2
pm2 -v
```

Why:
- Installs the process manager that keeps the app alive and restartable.
- Verifies PM2 is available in the active Node/NVM path.

## Step 2 Create PM2 App Config In Repo

File: `ecosystem.config.cjs`

Why:
- Keeps app startup behavior in source control.
- Prevents drift between manual starts and service starts.

Source:

```tsx
    module.exports = {
        apps: [
            {
                name: "family-social",
                cwd: "/home/ec2-user/projects/family-social",
                script: "node_modules/next/dist/bin/next",
                args: "start -p 3000 -H 0.0.0.0",
                instances: 1,
                kill_timeout: 120000,
                max_memory_restart: "1G",
                env: {
                NODE_ENV: "production"
                }
            }
        ]
    };
```

## Step 3: Configure Systemd To Manage PM2 At Boot

Service: `pm2-ec2-user.service`

Key behavior:
- Runs `ExecStartPre=/usr/local/bin/load-s3-master-key.sh`
- Starts PM2 runtime with the ecosystem config
- Enabled in `multi-user.target`

Why:
- App survives logout, reboot, and daemon restarts.
- Startup is repeatable and operationally consistent.

## Step 4: Load Runtime Env From Parameter Store Output

Runtime file: `/run/family-social.env`

Critical fixes applied:
- File must be readable by `ec2-user` (for PM2 process owner).
- Multiline secrets (Apple private key) must be written as one line with escaped `\\n`.

Why:
- Prevents shell parse failures and partial environment loads.
- Ensures PM2/systemd start with the same env as the old working service.

Source: 

Below is the source for the `/etc/systemd/system/pm2-ec2-user.service` that will persist the service during reboots.

```bash
    [Unit]
    Description=PM2 process manager
    After=network.target

    [Service]
    Type=simple
    User=ec2-user
    LimitNOFILE=infinity
    LimitNPROC=infinity
    LimitCORE=infinity
    PermissionsStartOnly=true

    # Rebuild env file at startup (as root, since /run is root-owned)
    ExecStartPre=+/usr/local/bin/load-s3-master-key.sh
    EnvironmentFile=/run/family-social.env

    Environment=PATH=/home/ec2-user/.nvm/versions/node/v25.2.1/bin:/usr/local/bin:/usr/bin:/bin
    Environment=PM2_HOME=/home/ec2-user/.pm2
    Restart=on-failure
    RestartSec=3

    # Prefer pm2-runtime to avoid resurrect/pid-file issues
    ExecStart=/home/ec2-user/.nvm/versions/node/v25.2.1/bin/pm2-runtime start /home/ec2-user/projects/family-social/ecosystem.config.cjs 
    ExecReload=/home/ec2-user/.nvm/versions/node/v25.2.1/bin/pm2 reload family-social --update-env
    ExecStop=/home/ec2-user/.nvm/versions/node/v25.2.1/bin/pm2 kill

    [Install]
    WantedBy=multi-user.target
```
Operations:

Commands below will restart this service, to also force a refresh of the Parameter Store parameters 
```bash
    sudo systemctl daemon-reload
    sudo systemctl restart pm2-ec2-user.service
    sudo systemctl status pm2-ec2-user.service --no-pager -l
    pm2 env 0 | egrep "FAMILY_SOCIAL_DATABASE_URL|DATABASE_URL|NODE_ENV"
```


## Step 5: Remove Bad Startup Flags And CWD Drift

Issues corrected during setup:
- Removed unsupported PM2 start flag usage that leaked to `next start`.
- Corrected process working directory so Next resolves `.next/BUILD_ID` and `.env*` paths from the project root.

Why:
- Prevents restart loops and `ENOTDIR` path errors.

## Step 6: Stabilize On Single Worker First

Observed final stable mode:
- PM2 app online in `fork` mode with stable uptime.
- `systemctl status pm2-ec2-user.service` active.
- `curl -I https://dev.my-family-social.com` returns `200`.

Why:
- Single-worker baseline reduces variables while validating env/service reliability.
- Scale-out can be added after a stable baseline window.

# Final Deploy Runbook

## Deploy
```bash
cd /home/ec2-user/projects/family-social
git pull origin main
npm ci
npm run build
sudo systemctl restart pm2-ec2-user.service
```

## Verify
```bash
sudo systemctl status pm2-ec2-user.service --no-pager -l
pm2 status
pm2 logs family-social --err --lines 60
curl -I --max-time 10 http://127.0.0.1:3000
curl -I --max-time 10 https://dev.my-family-social.com
```

## Rollback
```bash
cd /home/ec2-user/projects/family-social
git log --oneline -n 5
git reset --hard <previous-good-commit-sha>
npm ci
npm run build
sudo systemctl restart pm2-ec2-user.service
```
## Known-Good Baseline (Do Not Drift)

### [ecosystem.config.cjs](http://_vscodecontentref_/1)
    module.exports = {
      apps: [
        {
          name: "family-social",
          cwd: "/home/ec2-user/projects/family-social",
          script: "/home/ec2-user/projects/family-social/node_modules/next/dist/bin/next",
          args: "start -p 3000 -H 0.0.0.0",
          exec_mode: "fork",
          instances: 1,
          kill_timeout: 120000,
          max_memory_restart: "1G",
          env: { NODE_ENV: "production" }
        }
      ]
    };

### /etc/systemd/system/pm2-ec2-user.service
    [Unit]
    Description=PM2 process manager
    After=network.target

    [Service]
    Type=simple
    User=ec2-user
    LimitNOFILE=infinity
    LimitNPROC=infinity
    LimitCORE=infinity
    PermissionsStartOnly=true
    WorkingDirectory=/home/ec2-user/projects/family-social

    ExecStartPre=+/usr/local/bin/load-s3-master-key.sh
    EnvironmentFile=/run/family-social.env

    Environment=PATH=/home/ec2-user/.nvm/versions/node/v25.2.1/bin:/usr/local/bin:/usr/bin:/bin
    Environment=PM2_HOME=/home/ec2-user/.pm2
    Restart=on-failure
    RestartSec=3

    ExecStart=/home/ec2-user/.nvm/versions/node/v25.2.1/bin/pm2-runtime start /home/ec2-user/projects/family-social/ecosystem.config.cjs
    ExecReload=/home/ec2-user/.nvm/versions/node/v25.2.1/bin/pm2 reload family-social --update-env
    ExecStop=/home/ec2-user/.nvm/versions/node/v25.2.1/bin/pm2 kill

    [Install]
    WantedBy=multi-user.target

### Post-edit apply/verify
    sudo systemctl daemon-reload
    sudo systemctl reset-failed pm2-ec2-user.service
    sudo systemctl restart pm2-ec2-user.service
    sudo systemctl is-active pm2-ec2-user.service
    pm2 describe family-social


## Operating Notes

- Prefer `systemctl restart pm2-ec2-user.service` so env regeneration runs every deploy.
- Keep `npm ci` as default for deterministic installs; skip only when lock/deps are unchanged and speed is prioritized.
- Rotate any secret that appeared in shell output during troubleshooting.

# Troubleshooting

## Query for Errors

```bash
sudo journalctl -u pm2-ec2-user.service --since "1 hours ago" --no-pager | grep "error"
```

## Login Blocked by Missing Resend API Key

If the login page loads but credential and Google sign-in do not respond, inspect
the unfiltered journal while reproducing the problem:

```bash
sudo journalctl -u pm2-ec2-user.service -f -n 30 --no-pager
```

`Missing API key` at `send-2fa-code-email.ts` indicates that `RESEND_API_KEY`
is absent from the application's runtime environment. Previously, the email
client was constructed during module import, preventing all actions in the
login module from loading, including sign-in paths that do not send email.
The client is now created only when sending a 2FA email; missing configuration
returns an explicit error without blocking other login paths.

Add or restore `RESEND_API_KEY` in the Parameter Store configuration consumed
by `/usr/local/bin/load-s3-master-key.sh`, and ensure that script writes it to
`/run/family-social.env`. Do not paste the key into logs or troubleshooting output.
Check only that a nonempty entry exists:

```bash
sudo awk '
  /^[[:space:]]*RESEND_API_KEY=/ {
    value = $0
    sub(/^[[:space:]]*RESEND_API_KEY=/, "", value)
    gsub(/[[:space:]\047\042]/, "", value)
    if (length(value) > 0) found = 1
  }
  END {
    print found ? "RESEND_API_KEY entry present (value hidden)" : "RESEND_API_KEY missing or empty"
    exit !found
  }
' /run/family-social.env
```

After updating the configuration, restart the service to regenerate and load
the environment:

```bash
sudo systemctl restart pm2-ec2-user.service
sudo systemctl status pm2-ec2-user.service --no-pager -l
```

Repeat the presence check after restarting. An entry in the file alone does not
prove the running process loaded a valid key. Verify credential sign-in, Google
sign-in, and 2FA email delivery for an account with 2FA enabled. Deploy the code
fix using the normal deploy sequence above.

## Crashing PM2 Woker(s)

The following commands were run to troubleshoot PM2 workers crash-looping immediately after restart.

```bash
# stop the systemd wrapper
sudo systemctl stop pm2-ec2-user.service

# kill pm2 and remove saved process state
pm2 delete all || true
pm2 kill || true
rm -f ~/.pm2/dump.pm2 ~/.pm2/dump.pm2.bak
rm -f ~/.pm2/rpc.sock ~/.pm2/pub.sock ~/.pm2/pm2.pid

# confirm the env file is present before startup
sudo ls -l /run/family-social.env
sudo grep -E "FAMILY_SOCIAL_DATABASE_URL|DATABASE_URL|NODE_ENV" /run/family-social.env

# start clean under systemd again
sudo systemctl start pm2-ec2-user.service
sudo systemctl status pm2-ec2-user.service --no-pager -l
pm2 status
```

## Getting PM2 Error Logs

```bash
pm2 logs family-social --err --lines 80
```

## The pm2-ec2-user.service Service

- Is the service running?
    ```bash
    sudo systemctl is-active pm2-ec2-user.service  
    ```
- Review the logs
    ```bash
    sudo systemctl cat pm2-ec2-user.service
    ```

Practical rule:

If you changed ecosystem.config.cjs, run:

```bash
    pm2 restart <app> --update-env or service restart path
    pm2 save (if you rely on saved PM2 process list)
```
If systemd starts with pm2-runtime start ecosystem.config.cjs, restarting the service is usually enough to re-read it.

# EC2 runtime issues 

## Out of Space on EC2

1) Confirm space and inode pressure

    ```bash
    df -h
    df -i
    ```

2) See what's consuming space

    ```bash
    du -xh --max-depth=1 /home/ec2-user | sort -h
    du -xh --max-depth=1 /home/ec2-user/projects | sort -h
    ```

3) Clean project artifacts safely: `rm -rf node_modules .next`

4) Clean npm cache/logs
    ```bash
    npm cache clean --force
    find /home/ec2-user/.npm/_logs -type f -delete
    ```

5) Reinstall from lockfile (preferred for servers): `npm ci`

6) Build again: `npm run build`

## The `npm run build` Hangs

While running with an EC2 t3.medium instance, which has 4 GB of RAM. The issue is that, without stopping the current running app, there's not enough memory to run the `npm build`. I'll look into a T3.large EC2 instance type, which effectively doubles my monthly cost. 

However, stopping the current running server and then running the build is the viable approach. 

```bash
    pkill -f "next build"
    sudo systemctl stop pm2-ec2-user.service
    rm -rf .next
    npm run build
    sudo systemctl start pm2-ec2-user.service
```

## Create a swap file
To avoid stopping the app, as suggested in the previous section, a swap file can be created that would be used by the build. This will result in a slower build, but it shouldn't hang due to the memory issue. 

```bash
    sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
    free -h
```

## Expanding the EC2 volume 
The t3.medium EC2 instance type defaults to a 8 GB volume. For safe measures, I'm increasing it to a 20 GB volume.

Modify the EBS volume size (no downtime required):

### In AWS/EC2
1. Go to EC2 → Volumes → vol-048eb4fbeb77d76bd 
2. Select the volume → Actions → Modify Volume
3. Enter the new size (e.g., 20 GB, 50 GB)
4. Click Modify — AWS will expand the volume while the instance keeps running
5. Monitor the status to make sure it finished the expansion. 
 
### In EC2 instance
```bash
    # Check current disk usage
    df -h

    # Grow the partition (for xvda1 on Amazon Linux / Ubuntu)
    sudo growpart /dev/xvda 1

    # XFS (Amazon Linux 2023)
    sudo xfs_growfs /

```


# Schema Versioning Strategy

## Recommended approach
1. Keep immutable migrations for all shared environments (test, dev, qa, prod).
2. Maintain a schema metadata table with major.minor.patch per logical schema.
3. Validate schema compatibility at application startup and fail fast on incompatibility.

## Versioning policy
1. MAJOR: breaking schema contract changes (drop/rename/meaning changes).
2. MINOR: backward-compatible additions (nullable columns, additive tables).
3. PATCH: non-contract-safe updates (indexes/default tweaks/backfills).

## Schema metadata model
1. schema_name (family_schema, global_schema)
2. schema_version (for example, 2.4.1)
3. min_app_version
4. max_app_version (nullable)
5. last_migration_id
6. updated_at

## Startup compatibility check
1. App reads supported schema range from code or environment variables.
2. App queries metadata for both family and global schemas.
3. If out of range:
1. Production: fail startup or switch to maintenance mode.
2. Dev/Test: warn loudly; optionally auto-run migrations only in local dev.

## Safe deployment sequence
1. Expand: deploy additive schema migration first.
2. Transition: deploy app version that supports old and new shapes.
3. Migrate data: run backfills.
4. Contract: remove deprecated schema only after all app versions are compatible.

## Practical Next Actions
1. Track independent version rows for family and global schemas.
2. Add CI/CD gate ensuring migrations complete before app rollout.
3. Use migration files for shared environments.
4. Reserve push for local development only.

## npm ci Sequence

```bash
git pull --ff-only origin main   # get latest code + lockfile
npm ci --include=dev             # exact install from the fresh lockfile
npm run build                    # build with new deps in place
pm2 restart <app>                # or per your PM2 runbook
```