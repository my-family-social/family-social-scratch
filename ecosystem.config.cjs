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
    },
    {
      name: "family-social-digest",
      cwd: "/home/ec2-user/projects/family-social",
      script: "scripts/weekly-activity-digest-worker.ts",
      interpreter: "node",
      node_args: "--import tsx",
      exec_mode: "fork",
      instances: 1,
      watch: false,
      autorestart: true,
      restart_delay: 10000,
      kill_timeout: 120000,
      env: {
        NODE_ENV: "production"
      }
    }    
  ]
};