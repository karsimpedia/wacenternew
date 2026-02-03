module.exports = {
  apps: [
    {
      name: "wa-server",
      script: "index.js",
     

      instances: 1,
      exec_mode: "fork",

      env: {
        NODE_ENV: "production",
        TZ: "Asia/Jakarta"
      },

      // ini penting biar pm2 baca .env
      env_file: ".env",

      autorestart: true,
      watch: false,
      restart_delay: 3000,

      max_memory_restart: "500M",

      // out_file: "./logs/out.log",
      // error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};
