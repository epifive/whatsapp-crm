// PM2 (VPS without Docker):  npm ci && npm run build && pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "wa-crm-web",
      script: "npm",
      args: "start",
      env: { NODE_ENV: "production", PORT: 3000 },
      max_memory_restart: "1G",
    },
    {
      // Campaigns, scheduled messages, QR connections, chatbot flows, billing reminders
      name: "wa-crm-worker",
      script: "npm",
      args: "run worker",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
    },
  ],
};
