module.exports = {
  apps: [
    {
      name: "john_api",
      script: "dist/src/main.js", // nest build anida la salida bajo dist/src/
      interpreter: "/root/.nvm/versions/node/v22.23.1/bin/node", // Node 22 (nvm) — Prisma 7 requiere 20.19+/22.12+/24+
      exec_mode: "fork", // fork (no cluster) para que respete el interpreter custom
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M", // Reinicia si supera 500M de RAM
      min_uptime: "10s", // Tiempo mínimo antes de considerar la app estable
      max_restarts: 10, // Máximo 10 reinicios antes de parar
      restart_delay: 4000, // Esperar 4 segundos entre reinicios
      kill_timeout: 5000, // Dar 5 segundos para cerrar limpiamente
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_file: "logs/combined.log",
      time: true,
      merge_logs: true,
    },
  ],
};
